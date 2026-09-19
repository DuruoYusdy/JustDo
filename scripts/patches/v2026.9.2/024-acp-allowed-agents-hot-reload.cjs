'use strict';

// Capability: apply ACP agent allowlist edits through OpenClaw's native config hot reload.
// Target: openclaw@2026.9.2 config reload planner source/bundle.
// Scope: classification only; consumers already resolve allowedAgents from the published config
// snapshot for each prospective ACP operation. Existing sessions retain their own lifetime.
// Safety: the exact adjacent reload-policy anchors must occur once per source/bundle target;
// historical or partial markers fail closed, and no ACP runtime/session implementation is changed.
// Remove when: upstream classifies acp.allowedAgents as hot-reloadable.

const fs = require('fs');
const path = require('path');
const {
  countOccurrences,
  findFilesContaining,
  replaceUniquePattern,
  writeIfChanged,
} = require('./_patch-utils.js');

const MARKER = 'JUSTDO_ACP_ALLOWED_AGENTS_HOT_RELOAD_V2026_9_2';
const ANCHOR = '"acp.runtime.installCommand",';
const INSERTED = `"acp.allowedAgents", /*${MARKER}*/`;
const INSERTED_PATTERN =
  /"acp\.allowedAgents",(?:[ \t]*|\r?\n[ \t]*)\/\*JUSTDO_ACP_ALLOWED_AGENTS_HOT_RELOAD_V2026_9_2\*\//g;
const POLICY_ANCHOR_PATTERN =
  /^([ \t]*)"diagnostics\.cacheTrace\.enabled",\r?\n([ \t]*)"acp\.runtime\.installCommand",/gm;
const PATCHED_POLICY_PATTERN =
  /^([ \t]*)"diagnostics\.cacheTrace\.enabled",\r?\n\1"acp\.allowedAgents",(?:[ \t]*|\r?\n\1)\/\*JUSTDO_ACP_ALLOWED_AGENTS_HOT_RELOAD_V2026_9_2\*\/\r?\n\1"acp\.runtime\.installCommand",/gm;

const countPattern = (content, pattern) =>
  [...content.matchAll(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'))].length;

function transformReloadPlan(content, filePath) {
  const markerCount = countOccurrences(content, MARKER);
  const insertedCount = countPattern(content, INSERTED_PATTERN);
  const patchedPolicyCount = countPattern(content, PATCHED_POLICY_PATTERN);
  if (markerCount === 1 && insertedCount === 1 && patchedPolicyCount === 1) return content;
  if (markerCount !== 0 || insertedCount !== 0) {
    throw new Error(
      `${filePath}: partial ACP allowedAgents hot-reload patch detected ` +
        `(marker=${markerCount}, inserted=${insertedCount}, policy=${patchedPolicyCount})`,
    );
  }

  return replaceUniquePattern(
    content,
    POLICY_ANCHOR_PATTERN,
    `$1"diagnostics.cacheTrace.enabled",\n$2${INSERTED}\n$2${ANCHOR}`,
    `${filePath}: ACP reload policy anchor`,
  );
}

function locateTargets(runtimeDir) {
  const targets = new Set(findFilesContaining(runtimeDir, [ANCHOR, 'diagnostics.cacheTrace.enabled']));
  for (const filePath of findFilesContaining(runtimeDir, [MARKER])) targets.add(filePath);
  const bundleExists = fs.existsSync(path.join(runtimeDir, 'gateway-bundle.mjs'));
  const sourceTargets = [...targets].filter(filePath => path.basename(filePath) !== 'gateway-bundle.mjs');
  const bundleTargets = [...targets].filter(filePath => path.basename(filePath) === 'gateway-bundle.mjs');
  if (sourceTargets.length !== 1 || bundleTargets.length !== (bundleExists ? 1 : 0)) {
    throw new Error(
      `ACP allowedAgents hot-reload target counts are source=${sourceTargets.length}, ` +
        `bundle=${bundleTargets.length}; expected source=1, bundle=${bundleExists ? 1 : 0}`,
    );
  }
  return [...sourceTargets, ...bundleTargets];
}

function applyPatch(runtimeDir) {
  const staged = locateTargets(runtimeDir).map(filePath => {
    const original = fs.readFileSync(filePath, 'utf8');
    return { filePath, original, updated: transformReloadPlan(original, filePath) };
  });
  return staged
    .filter(item => writeIfChanged(item.filePath, item.original, item.updated))
    .map(item => path.relative(runtimeDir, item.filePath));
}

function verifyPatch(runtimeDir) {
  for (const filePath of locateTargets(runtimeDir)) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (
      countOccurrences(content, MARKER) !== 1 ||
      countPattern(content, INSERTED_PATTERN) !== 1 ||
      countPattern(content, PATCHED_POLICY_PATTERN) !== 1
    ) {
      throw new Error(`${filePath}: ACP allowedAgents hot-reload contract is incomplete`);
    }
  }
}

module.exports = {
  applyPatch,
  verifyPatch,
  __testing: {
    ANCHOR,
    INSERTED,
    INSERTED_PATTERN,
    MARKER,
    PATCHED_POLICY_PATTERN,
    POLICY_ANCHOR_PATTERN,
    transformReloadPlan,
  },
};
