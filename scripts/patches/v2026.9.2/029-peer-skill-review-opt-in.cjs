'use strict';

// Capability: do not create peer skill-review monitors without an existing opt-in.
// Target: OpenClaw's native skill-review reconciliation, for both creation paths.
// Scope: preserve existing peer enablement and the global autonomous-mode gate; main stays native.
// Safety: reject ambiguous anchors and partial markers; do not change task history or scheduling.
// Remove when: upstream supports opt-in creation of peer collection-review monitors.
const fs = require('fs');
const path = require('path');
const { countOccurrences, findFilesContaining, writeIfChanged } = require('./_patch-utils.js');

const MARKER = 'JUSTDO_PEER_SKILL_REVIEW_OPT_IN_V2026_9_2';
const ANCHOR =
  'const { retained, duplicates } = partitionSystemMonitors(jobs, skillCollectionReviewMonitorAgentId);';
const BODY = `specs.splice(0, specs.length, ...specs.filter((spec) => spec.agentId === "main" || retained.has(spec.agentId)));
for (const justdoSkillReviewSpec of specs) {
  if (justdoSkillReviewSpec.agentId !== "main") {
    justdoSkillReviewSpec.input.enabled = justdoSkillReviewSpec.input.enabled && retained.get(justdoSkillReviewSpec.agentId)?.enabled === true;
  }
}`;
const INSERTED = `${ANCHOR}\n/*${MARKER}*/\n${BODY}`;
const patternFor = text =>
  new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'g');

function transform(content, filePath, options = {}) {
  const marked = countOccurrences(content, MARKER);
  const complete = [...content.matchAll(patternFor(INSERTED))].length;
  if (
    marked === 1 &&
    complete === 1 &&
    [...content.matchAll(patternFor(ANCHOR))].length === 1 &&
    countOccurrences(content, 'const justdoSkillReviewSpec') === 1
  )
    return content;
  // esbuild removes the standalone marker comment. Only the orchestrator's
  // proven fresh bundle pass may restore it, and only for this exact body.
  const unmarked = patternFor(`${ANCHOR}\n${BODY}`);
  if (
    options.freshBundlePass === true &&
    path.basename(filePath) === 'gateway-bundle.mjs' &&
    !content.includes('JUSTDO_PEER_SKILL_REVIEW_') &&
    [...content.matchAll(unmarked)].length === 1 &&
    [...content.matchAll(patternFor(ANCHOR))].length === 1 &&
    countOccurrences(content, 'const justdoSkillReviewSpec') === 1
  ) {
    return content.replace(unmarked, INSERTED);
  }
  if (
    marked ||
    content.includes('JUSTDO_PEER_SKILL_REVIEW_') ||
    content.includes('justdoSkillReviewSpec')
  ) {
    throw new Error(
      `${filePath}: partial or historical peer skill-review patch; rebuild from pristine`,
    );
  }
  if (countOccurrences(content, ANCHOR) !== 1) {
    throw new Error(`${filePath}: expected one skill-review reconciliation anchor`);
  }
  return content.replace(ANCHOR, INSERTED);
}

function targets(runtimeDir) {
  // Upstream also ships a minified worker distribution. JustDo starts the
  // Gateway from dist and its own gateway-bundle, not that worker entrypoint.
  const workerPath = path.resolve(runtimeDir, 'dist', 'worker', 'worker.mjs');
  const files = findFilesContaining(runtimeDir, [
    'skillCollectionReviewMonitorAgentId',
    'partitionSystemMonitors',
  ]).filter(file => path.resolve(file) !== workerPath);
  const source = files.filter(file => path.basename(file) !== 'gateway-bundle.mjs');
  const bundle = files.filter(file => path.basename(file) === 'gateway-bundle.mjs');
  if (
    source.length !== 1 ||
    bundle.length !== Number(fs.existsSync(path.join(runtimeDir, 'gateway-bundle.mjs')))
  ) {
    throw new Error(
      `Expected one skill-review reconciliation source and its bundle when present; ` +
        `found source=${source.length}, bundle=${bundle.length}: ` +
        files.map(file => path.relative(runtimeDir, file)).join(', '),
    );
  }
  return files;
}

function applyPatch(runtimeDir, options = {}) {
  const staged = targets(runtimeDir).map(filePath => {
    const original = fs.readFileSync(filePath, 'utf8');
    return { filePath, original, updated: transform(original, filePath, options) };
  });
  return staged
    .filter(item => writeIfChanged(item.filePath, item.original, item.updated))
    .map(item => path.relative(runtimeDir, item.filePath));
}

function verifyPatch(runtimeDir) {
  for (const filePath of targets(runtimeDir)) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(MARKER) || transform(content, filePath) !== content) {
      throw new Error(`${filePath}: peer skill-review default contract is incomplete`);
    }
  }
}

module.exports = { applyPatch, verifyPatch, __testing: { ANCHOR, MARKER, transform } };
