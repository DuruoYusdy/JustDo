'use strict';

// Capability: carry trusted-local, untrusted external context to an agent turn without storing
// that context as the visible user message.
// Target: pristine openclaw@2026.9.2 after JustDo patch 006.
// Scope: chat.send schema plus the gateway user-turn preparation boundary.
// Safety: only the authenticated local JustDo backend can activate the field. The transcript keeps
// rawMessage while the agent-only body receives the bounded context.
// Remove when: upstream exposes a trusted-client per-turn context field with separate transcript
// and model projections.

const fs = require('fs');
const path = require('path');
const {
  assertCurrentPatchContract,
  findFilesContaining,
  isGatewayBundlePath,
  replaceUniquePattern,
  writeIfChanged,
} = require('./_patch-utils.js');

const CONTRACT = 'JUSTDO_PRIVATE_UNTRUSTED_CONTEXT_V2026_9_2';
const SCHEMA_MARKER = `${CONTRACT}: chat send schema`;
const CONTEXT_MARKER = `${CONTRACT}: agent-only context`;
const MAX_CONTEXT_LENGTH = 24_000;

const CONTEXT_AUTHORIZATION =
  'params.client?.internal?.isLocalClient === true && params.client?.connect?.client?.id === "gateway-client" && params.client?.connect?.client?.mode === "backend" && params.client?.connect?.scopes?.includes("operator.admin")';
const APPLIED_SOURCE_SCHEMA_PATTERN =
  /justdoUntrustedContext:\s*([A-Za-z_$][\w$]*)\.Optional\(\1\.String\(\{\s*maxLength:\s*(?:24000|24e3)\s*\}\)\)/;
const APPLIED_WORKER_SCHEMA_PATTERN =
  /justdoUntrustedContext:\s*[A-Za-z_$][\w$]*\(\s*[A-Za-z_$][\w$]*\(\{\s*maxLength:\s*(?:24000|24e3)\s*\}\)\s*\)/;
const APPLIED_CONTEXT_PATTERN =
  /const\s+justDoUntrustedContext\s*=\s*typeof\s+([A-Za-z_$][\w$]*)\.p\?\.justdoUntrustedContext\s*===\s*["']string["']\s*&&\s*params\.client\?\.internal\?\.isLocalClient\s*===\s*true\s*&&\s*params\.client\?\.connect\?\.client\?\.id\s*===\s*["']gateway-client["']\s*&&\s*params\.client\?\.connect\?\.client\?\.mode\s*===\s*["']backend["']\s*&&\s*params\.client\?\.connect\?\.scopes\?\.includes\(["']operator\.admin["']\)\s*\?\s*\1\.p\.justdoUntrustedContext\.trim\(\)\s*:\s*["']["']\s*;[\s\S]*?\[[A-Za-z_$][\w$]*\.systemProvenanceReceipt,\s*justDoUntrustedContext,\s*[A-Za-z_$][\w$]*\.parsedMessage\]\.filter\(Boolean\)\.join\(["']\\n\\n["']\)/;

function hasCurrentSchema(content) {
  return APPLIED_SOURCE_SCHEMA_PATTERN.test(content) || APPLIED_WORKER_SCHEMA_PATTERN.test(content);
}

function expectedCounts(runtimeDir) {
  const withBundle = fs.existsSync(path.join(runtimeDir, 'gateway-bundle.mjs'));
  return { schema: withBundle ? 3 : 2, context: withBundle ? 2 : 1 };
}

function patchSchema(content, filePath) {
  assertCurrentPatchContract(content, CONTRACT, filePath, false);
  if (content.includes('justdoUntrustedContext:')) {
    if (!hasCurrentSchema(content)) {
      throw new Error(`${filePath}: historical or partial private context schema`);
    }
    if (!isGatewayBundlePath(filePath) && !content.includes(SCHEMA_MARKER)) {
      throw new Error(`${filePath}: historical or partial private context schema`);
    }
    return content;
  }
  const objectPattern =
    /(justdoHideUserMessage:\s*([A-Za-z_$][\w$]*)\.Optional\(\2\.Boolean\(\)\),\s*(?:\/\/[^\r\n]*\r?\n\s*)?)(systemProvenanceReceipt:)/;
  if (objectPattern.test(content)) {
    return replaceUniquePattern(
      content,
      objectPattern,
      (_match, prefix, typebox, suffix) =>
        `${prefix}justdoUntrustedContext: ${typebox}.Optional(${typebox}.String({ maxLength: ${MAX_CONTEXT_LENGTH} })), // ${SCHEMA_MARKER}\n${suffix}`,
      `${filePath}: private context schema`,
    );
  }
  const stringBuilder = /\bmessage:\s*([A-Za-z_$][\w$]*)\(\)/.exec(content)?.[1];
  if (!stringBuilder) throw new Error(`${filePath}: chat message string schema is unknown`);
  return replaceUniquePattern(
    content,
    /(justdoHideUserMessage:\s*([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\(\)\),\s*)(\/\*[^*]*chat send schema\*\/\s*systemProvenanceReceipt:)/,
    (_match, prefix, optional, _boolean, suffix) =>
      `${prefix}justdoUntrustedContext:${optional}(${stringBuilder}({maxLength:${MAX_CONTEXT_LENGTH}})),/*${SCHEMA_MARKER}*/${suffix}`,
    `${filePath}: worker private context schema`,
  );
}

function patchAgentContext(content, filePath) {
  assertCurrentPatchContract(content, CONTRACT, filePath, false);
  if (APPLIED_CONTEXT_PATTERN.test(content)) {
    if (!isGatewayBundlePath(filePath) && !content.includes(CONTEXT_MARKER)) {
      throw new Error(`${filePath}: historical or partial agent-only private context`);
    }
    return content;
  }
  if (/\bjustDoUntrustedContext\b/.test(content) || content.includes(CONTEXT_MARKER)) {
    throw new Error(`${filePath}: historical or partial agent-only private context`);
  }
  return replaceUniquePattern(
    content,
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.systemProvenanceReceipt\s*\?\s*\[\2\.systemProvenanceReceipt,\s*([A-Za-z_$][\w$]*)\.parsedMessage\]\.filter\(Boolean\)\.join\(["']\\n\\n["']\)\s*:\s*\3\.parsedMessage\s*;/,
    (_match, messageName, requestName, attachmentsName) =>
      `const justDoUntrustedContext = typeof ${requestName}.p?.justdoUntrustedContext === "string" && ${CONTEXT_AUTHORIZATION} ? ${requestName}.p.justdoUntrustedContext.trim() : "";\n  const ${messageName} = [${requestName}.systemProvenanceReceipt, justDoUntrustedContext, ${attachmentsName}.parsedMessage].filter(Boolean).join("\\n\\n"); // ${CONTEXT_MARKER}`,
    `${filePath}: agent-only private context`,
  );
}

function targetFiles(runtimeDir) {
  return {
    schema: findFilesContaining(runtimeDir, [
      'ChatSendParamsSchema',
      'justdoHideUserMessage:',
      'systemProvenanceReceipt:',
    ]),
    context: findFilesContaining(runtimeDir, [
      'function prepareChatSendUserTurn(',
      'const messageForAgent =',
      'attachments.parsedMessage',
    ]),
  };
}

function assertTargetCounts(runtimeDir, files) {
  const expected = expectedCounts(runtimeDir);
  for (const key of ['schema', 'context']) {
    if (files[key].length !== expected[key]) {
      throw new Error(
        `${key} private context target count is ${files[key].length}, expected ${expected[key]}`,
      );
    }
  }
}

function applyPatch(runtimeDir) {
  const files = targetFiles(runtimeDir);
  assertTargetCounts(runtimeDir, files);
  const transforms = new Map();
  const add = (filePath, transform) => {
    transforms.set(filePath, [...(transforms.get(filePath) ?? []), transform]);
  };
  for (const filePath of files.schema) add(filePath, patchSchema);
  for (const filePath of files.context) add(filePath, patchAgentContext);
  const changed = [];
  for (const [filePath, fileTransforms] of transforms) {
    const original = fs.readFileSync(filePath, 'utf8');
    const updated = fileTransforms.reduce(
      (current, transform) => transform(current, filePath),
      original,
    );
    if (writeIfChanged(filePath, original, updated))
      changed.push(path.relative(runtimeDir, filePath));
  }
  return changed;
}

function verifyPatch(runtimeDir) {
  const files = targetFiles(runtimeDir);
  assertTargetCounts(runtimeDir, files);
  for (const filePath of files.schema) {
    const content = fs.readFileSync(filePath, 'utf8');
    assertCurrentPatchContract(content, CONTRACT, filePath, !isGatewayBundlePath(filePath));
    if (!isGatewayBundlePath(filePath) && !content.includes(SCHEMA_MARKER)) {
      throw new Error(`${filePath}: current private context schema marker is missing`);
    }
    if (!hasCurrentSchema(content)) {
      throw new Error(`${filePath}: current private context schema is missing`);
    }
  }
  for (const filePath of files.context) {
    const content = fs.readFileSync(filePath, 'utf8');
    assertCurrentPatchContract(content, CONTRACT, filePath, !isGatewayBundlePath(filePath));
    if (!isGatewayBundlePath(filePath) && !content.includes(CONTEXT_MARKER)) {
      throw new Error(`${filePath}: agent-only private context marker is missing`);
    }
    if (!APPLIED_CONTEXT_PATTERN.test(content)) {
      throw new Error(`${filePath}: current agent-only private context is missing`);
    }
  }
}

module.exports = {
  applyPatch,
  patchAgentContext,
  patchSchema,
  verifyPatch,
  __testing: {
    CONTEXT_MARKER,
    CONTRACT,
    MAX_CONTEXT_LENGTH,
    SCHEMA_MARKER,
  },
};
