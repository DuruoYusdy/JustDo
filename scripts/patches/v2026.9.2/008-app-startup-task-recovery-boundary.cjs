'use strict';

// Capability: retire active work accepted before the current JustDo app process.
// Target: openclaw@2026.9.2's main-session recovery and durable task maintenance passes.
// Scope: running main sessions and queued/running tasks; one host epoch survives Gateway restarts.
// Safety: prior-app work becomes terminal before OpenClaw can dispatch model/task recovery.
// Remove when: upstream exposes a host-instance recovery epoch in durable session/task state.

const fs = require('fs');
const path = require('path');
const {
  countOccurrences,
  findFilesContaining,
  findMatchingDelimiter,
  replaceUniquePattern,
  writeIfChanged,
} = require('./_patch-utils.js');

const CONTRACT = 'JUSTDO_APP_STARTUP_TASK_RECOVERY_BOUNDARY_V2026_9_2';
const MAIN_CONTRACT = 'JUSTDO_APP_STARTUP_MAIN_RECOVERY_BOUNDARY_V2026_9_2';
const APP_STARTED_AT_ENV = 'JUSTDO_APP_STARTED_AT_MS';
const READ_HELPER = 'readJustDoAppStartedAtMs';
const PRIOR_HELPER = 'isJustDoPriorAppActiveTask';
const RETIRE_HELPER = 'retireJustDoPriorAppTask';
const MAIN_READ_HELPER = 'readJustDoMainAppStartedAtMs';
const MAIN_PRIOR_HELPER = 'isJustDoPriorAppMainSession';
const MAIN_SETTLE_HELPER = 'settleJustDoPriorAppMainSession';

const HELPER_BLOCK = `// ${CONTRACT}: a Gateway restart reuses this host-process epoch.
function ${READ_HELPER}() {
\tconst value = Number(process.env.${APP_STARTED_AT_ENV});
\treturn Number.isFinite(value) && value > 0 ? value : void 0;
}
function ${PRIOR_HELPER}(task) {
\tif (!isActiveTask(task)) return false;
\tconst appStartedAtMs = ${READ_HELPER}();
\tif (appStartedAtMs === void 0) return false;
\tconst createdAt = Number(task.createdAt);
\treturn !Number.isFinite(createdAt) || createdAt < appStartedAtMs;
}
function ${RETIRE_HELPER}(task, now) {
\treturn taskRegistryMaintenanceRuntime.markTaskTerminalById({
\t\ttaskId: task.taskId,
\t\tstatus: "cancelled",
\t\tendedAt: now,
\t\tlastEventAt: now,
\t\terror: "interrupted by JustDo app restart"
\t}) ?? task;
}`;

const MAIN_HELPER_BLOCK = `// Only Gateway restarts inside this host epoch recover.
function ${MAIN_READ_HELPER}() {
  const value = Number(process.env.${APP_STARTED_AT_ENV});
  return Number.isFinite(value) && value > 0 ? value : void 0;
}
function ${MAIN_PRIOR_HELPER}(entry) {
  const appStartedAtMs = ${MAIN_READ_HELPER}();
  if (appStartedAtMs === void 0) return false;
  const startedAt = Number(entry?.startedAt);
  return !Number.isFinite(startedAt) || startedAt < appStartedAtMs;
}
async function ${MAIN_SETTLE_HELPER}(params) {
  const endedAt = Date.now();
  let settled = false;
  await applySessionEntryReplacements({
    sessionKeys: [params.sessionKey],
    storePath: params.storePath,
    update: (entries) => {
      const current = entries.find((candidate) => candidate.sessionKey === params.sessionKey);
      const entry = current?.entry;
      if (!entry || entry.sessionId !== params.sessionId || entry.status !== "running" ||
          entry.abortedLastRun !== true || !${MAIN_PRIOR_HELPER}(entry)) {
        return { result: false };
      }
      Object.assign(entry, {
        ...buildRestartRecoveryClaimCleanupPatch({ entry, recordTerminalSource: false }),
        ...buildMainSessionRecoveryClearPatch(entry),
        status: "failed",
        activeWriterRunId: void 0,
        lifecycleRunId: void 0,
        lastRunId: resolveRestartRecoveryTerminalClientRunId(entry),
        abortedLastRun: false,
        endedAt,
        lastRunError: "interrupted by JustDo app restart",
        runtimeMs: typeof entry.startedAt === "number" ? Math.max(0, endedAt - entry.startedAt) : void 0,
        updatedAt: endedAt
      });
      settled = true;
      return { result: true, replacements: [{ sessionKey: params.sessionKey, entry }] };
    }
  });
  return settled;
}
${MAIN_READ_HELPER}.${MAIN_CONTRACT} = true;
`;

const REQUIRED = [
  `process.env.${APP_STARTED_AT_ENV}`,
  `function ${PRIOR_HELPER}(`,
  `function ${RETIRE_HELPER}(`,
  `${PRIOR_HELPER}(`,
  'status: "cancelled"',
  'interrupted by JustDo app restart',
];

function readJustDoAppStartedAtMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isPriorAppActiveTask(task, appStartedAtMs) {
  if (task?.status !== 'queued' && task?.status !== 'running') return false;
  if (appStartedAtMs === undefined) return false;
  const createdAt = Number(task.createdAt);
  return !Number.isFinite(createdAt) || createdAt < appStartedAtMs;
}

function isPriorAppMainSession(entry, appStartedAtMs) {
  if (appStartedAtMs === undefined) return false;
  const startedAt = Number(entry?.startedAt);
  return !Number.isFinite(startedAt) || startedAt < appStartedAtMs;
}

function expectedCount(runtimeDir) {
  return fs.existsSync(path.join(runtimeDir, 'gateway-bundle.mjs')) ? 3 : 2;
}

function taskTargets(runtimeDir) {
  return findFilesContaining(runtimeDir, [
    'async function runTaskRegistryMaintenance()',
    'taskRegistryMaintenanceRuntime.markTaskTerminalById',
    'tryRecoverTaskBeforeMarkLost',
  ]);
}

function mainTargets(runtimeDir) {
  return findFilesContaining(runtimeDir, [
    'async function recoverStore(',
    'const recoveryView = observed.transition.view',
    'buildMainSessionRecoveryClearPatch',
    'resolveRestartRecoveryTerminalClientRunId',
  ]);
}

function findNamedFunctionRange(content, functionName, filePath) {
  const signature = `function ${functionName}(`;
  const signatureIndex = content.indexOf(signature);
  if (signatureIndex < 0 || content.indexOf(signature, signatureIndex + signature.length) >= 0)
    throw new Error(`${filePath}: ${functionName} target is missing or ambiguous`);
  const parameterStart = signatureIndex + signature.length - 1;
  const parameterEnd = findMatchingDelimiter(
    content,
    parameterStart,
    '(',
    ')',
    `${filePath}: ${functionName} parameters`,
  );
  let bodyStart = parameterEnd + 1;
  while (/\s/.test(content[bodyStart] ?? '')) bodyStart += 1;
  const bodyEnd = findMatchingDelimiter(
    content,
    bodyStart,
    '{',
    '}',
    `${filePath}: ${functionName} body`,
  );
  return { signatureIndex, bodyStart, bodyEnd, body: content.slice(bodyStart + 1, bodyEnd) };
}

function findMaintenanceCounters(body, filePath) {
  const now = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*Date\.now\(\)/.exec(body)?.[1];
  const reconciled =
    /status\s*===?\s*(?:"lost"|`lost`)[\s\S]{0,48}?([A-Za-z_$][\w$]*)\s*\+=\s*1/.exec(body)?.[1];
  const processed = /([A-Za-z_$][\w$]*)\s*%\s*SWEEP_YIELD_BATCH_SIZE/.exec(body)?.[1];
  if (!now || !reconciled || !processed)
    throw new Error(`${filePath}: task maintenance counters are unknown`);
  return { now, reconciled, processed };
}

function transformTask(content, filePath) {
  const present = REQUIRED.filter(contract => content.includes(contract));
  if (present.length === REQUIRED.length) return content;
  const patchSpecificPresent = [
    CONTRACT,
    `function ${READ_HELPER}(`,
    `function ${PRIOR_HELPER}(`,
    `function ${RETIRE_HELPER}(`,
  ].filter(contract => content.includes(contract));
  if (patchSpecificPresent.length > 0)
    throw new Error(`${filePath}: historical or partial app-start task boundary patch detected`);

  const shouldMarkLostIndex = content.indexOf('function shouldMarkLost(');
  if (
    shouldMarkLostIndex < 0 ||
    content.indexOf('function shouldMarkLost(', shouldMarkLostIndex + 1) >= 0
  )
    throw new Error(`${filePath}: shouldMarkLost target is missing or ambiguous`);

  let updated = `${content.slice(0, shouldMarkLostIndex)}${HELPER_BLOCK}${content.slice(
    shouldMarkLostIndex,
  )}`;
  const range = findNamedFunctionRange(updated, 'runTaskRegistryMaintenance', filePath);
  const { now, reconciled, processed } = findMaintenanceCounters(range.body, filePath);
  const currentPattern =
    /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*taskRegistryMaintenanceRuntime\.getTaskById\([^;]+\);\s*if\s*\(\s*!\1\s*\)\s*(?:\{\s*continue;\s*\}|continue;)/;
  const patchedBody = replaceUniquePattern(
    range.body,
    currentPattern,
    match => {
      const current = currentPattern.exec(match)[1];
      return `${match}
\t\tif (${PRIOR_HELPER}(${current})) {
\t\t\tconst justDoRetiredPriorAppTask = ${RETIRE_HELPER}(${current}, ${now});
\t\t\tif (justDoRetiredPriorAppTask.status === "cancelled") ${reconciled} += 1;
\t\t\t${processed} += 1;
\t\t\tif (${processed} % SWEEP_YIELD_BATCH_SIZE === 0) await yieldToEventLoop();
\t\t\tcontinue;
\t\t}`;
    },
    `${filePath}: task recovery boundary`,
  );
  updated = `${updated.slice(0, range.bodyStart + 1)}${patchedBody}${updated.slice(range.bodyEnd)}`;
  return updated;
}

function transformMain(content, filePath) {
  const markerCount = countOccurrences(content, MAIN_CONTRACT);
  const hasReadHelper = content.includes(`function ${MAIN_READ_HELPER}(`);
  const hasPriorHelper = content.includes(`function ${MAIN_PRIOR_HELPER}(`);
  const hasSettleHelper = content.includes(`async function ${MAIN_SETTLE_HELPER}(`);
  if (markerCount === 1 && hasReadHelper && hasPriorHelper && hasSettleHelper) {
    assertMainContracts(content, filePath);
    return content;
  }
  if (markerCount > 0 || hasReadHelper || hasPriorHelper || hasSettleHelper) {
    throw new Error(`${filePath}: historical or partial app-start main recovery patch detected`);
  }

  const range = findRecoverStoreRange(content, filePath);
  const resultName = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*started:\s*0,\s*settled:\s*0/u.exec(
    range.body,
  )?.[1];
  const loopMatch =
    /for\s*\(\s*const\s*\{\s*sessionKey(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*,\s*entry:\s*loadedEntry\s*\}/u.exec(
      range.body,
    );
  const sessionKeyName = loopMatch?.[1] ?? (loopMatch ? 'sessionKey' : undefined);
  const observed = /const\s+observed\s*=\s*await\s+commitMainSessionRecovery\s*\(/u.exec(range.body);
  if (!resultName || !sessionKeyName || !observed) {
    throw new Error(`${filePath}: app-start main recovery insertion context is unknown`);
  }
  const guard = `if (${MAIN_PRIOR_HELPER}(entry)) {
      const justDoSettled = await ${MAIN_SETTLE_HELPER}({
        sessionId: entry.sessionId,
        sessionKey: ${sessionKeyName},
        storePath: params.storePath
      });
      if (justDoSettled) {
        params.handledSessionKeys.add(resumeDedupeKey);
        ${resultName}.settled++;
        mainSessionRecoveryLog.info(\`interrupted prior-app main session: \${${sessionKeyName}}\`);
      } else ${resultName}.skipped++;
      continue;
    }
    `;
  const observedIndex = range.bodyStart + 1 + observed.index;
  const updated =
    content.slice(0, range.signatureIndex) +
    MAIN_HELPER_BLOCK +
    content.slice(range.signatureIndex, observedIndex) +
    guard +
    content.slice(observedIndex);
  assertMainContracts(updated, filePath);
  return updated;
}

function assertTaskContracts(content, filePath) {
  for (const required of REQUIRED) {
    if (!content.includes(required)) throw new Error(`${filePath}: missing ${required}`);
  }
  const range = findNamedFunctionRange(content, 'runTaskRegistryMaintenance', filePath);
  const boundaryIndex = range.body.indexOf(`${PRIOR_HELPER}(`);
  const cronRecoveryIndex = range.body.indexOf('resolveDurableCronTaskRecovery(');
  const detachedRecoveryIndex = range.body.indexOf('tryRecoverTaskBeforeMarkLost(');
  if (
    boundaryIndex < 0 ||
    boundaryIndex > cronRecoveryIndex ||
    boundaryIndex > detachedRecoveryIndex
  )
    throw new Error(`${filePath}: prior-app tasks can reach native recovery before retirement`);
}

function findRecoverStoreRange(content, filePath) {
  const signature = 'async function recoverStore(';
  const signatureIndex = content.indexOf(signature);
  if (signatureIndex < 0 || content.indexOf(signature, signatureIndex + signature.length) >= 0) {
    throw new Error(`${filePath}: recoverStore target is missing or ambiguous`);
  }
  const parameterStart = signatureIndex + signature.length - 1;
  const parameterEnd = findMatchingDelimiter(
    content,
    parameterStart,
    '(',
    ')',
    `${filePath}: recoverStore parameters`,
  );
  let bodyStart = parameterEnd + 1;
  while (/\s/u.test(content[bodyStart] ?? '')) bodyStart += 1;
  const bodyEnd = findMatchingDelimiter(
    content,
    bodyStart,
    '{',
    '}',
    `${filePath}: recoverStore body`,
  );
  return { signatureIndex, bodyStart, bodyEnd, body: content.slice(bodyStart + 1, bodyEnd) };
}

function assertMainContracts(content, filePath) {
  for (const required of [
    MAIN_CONTRACT,
    `process.env.${APP_STARTED_AT_ENV}`,
    `function ${MAIN_PRIOR_HELPER}(`,
    `async function ${MAIN_SETTLE_HELPER}(`,
    'interrupted by JustDo app restart',
    'interrupted prior-app main session',
  ]) {
    if (!content.includes(required)) throw new Error(`${filePath}: missing ${required}`);
  }
  const range = findRecoverStoreRange(content, filePath);
  const boundaryIndex = range.body.indexOf(`${MAIN_PRIOR_HELPER}(entry)`);
  const dispatchIndex = range.body.indexOf('commitMainSessionRecovery(');
  if (boundaryIndex < 0 || dispatchIndex < 0 || boundaryIndex > dispatchIndex) {
    throw new Error(`${filePath}: prior-app main session can reach native recovery dispatch`);
  }
}

function applyPatch(runtimeDir) {
  const tasks = taskTargets(runtimeDir);
  const mains = mainTargets(runtimeDir);
  const expectedTasks = expectedCount(runtimeDir);
  const expectedMains = fs.existsSync(path.join(runtimeDir, 'gateway-bundle.mjs')) ? 2 : 1;
  if (tasks.length !== expectedTasks)
    throw new Error(
      `app-start task boundary target count is ${tasks.length}, expected ${expectedTasks}`,
    );
  if (mains.length !== expectedMains)
    throw new Error(
      `app-start main boundary target count is ${mains.length}, expected ${expectedMains}`,
    );
  const changed = [];
  const transforms = new Map();
  for (const filePath of tasks) transforms.set(filePath, [transformTask]);
  for (const filePath of mains) {
    const fileTransforms = transforms.get(filePath) ?? [];
    fileTransforms.push(transformMain);
    transforms.set(filePath, fileTransforms);
  }
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
  const tasks = taskTargets(runtimeDir);
  const mains = mainTargets(runtimeDir);
  const expectedTasks = expectedCount(runtimeDir);
  const expectedMains = fs.existsSync(path.join(runtimeDir, 'gateway-bundle.mjs')) ? 2 : 1;
  if (tasks.length !== expectedTasks)
    throw new Error(
      `app-start task boundary target count is ${tasks.length}, expected ${expectedTasks}`,
    );
  if (mains.length !== expectedMains)
    throw new Error(
      `app-start main boundary target count is ${mains.length}, expected ${expectedMains}`,
    );
  for (const filePath of tasks) assertTaskContracts(fs.readFileSync(filePath, 'utf8'), filePath);
  for (const filePath of mains) assertMainContracts(fs.readFileSync(filePath, 'utf8'), filePath);
}

module.exports = {
  applyPatch,
  verifyPatch,
  __testing: {
    APP_STARTED_AT_ENV,
    CONTRACT,
    MAIN_CONTRACT,
    isPriorAppActiveTask,
    isPriorAppMainSession,
    readJustDoAppStartedAtMs,
    transformMain,
    transformTask,
  },
};
