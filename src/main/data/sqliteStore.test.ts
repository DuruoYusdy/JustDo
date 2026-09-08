import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkPlanHandoffState } from '../../shared/cowork/planHandoff';
import { PRODUCT_NAME_LOWERCASE } from '../../shared/productMetadata';
import { DB_FILENAME } from '../core/appConstants';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(`test-cipher:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^test-cipher:/, ''),
  },
}));

import { CoworkStore } from './coworkStore';
import { SqliteStore } from './sqliteStore';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-sqlite-store-'));
  tempDirs.push(dir);
  return dir;
}

test('persists builtin references without changing unrelated legacy credentials', () => {
  const store = SqliteStore.create(createTempDir());
  try {
    const config = { providers: { builtin_models: { apiKey: 'builtin-fixture-key' } }, api: { key: 'legacy-fixture-key' } };
    store.set('app_config', config);
    const row = store.getDatabase().prepare('SELECT value FROM kv WHERE key = ?').get('app_config') as { value: string };
    expect(row.value).not.toContain('builtin-fixture-key');
    expect(row.value).toContain('legacy-fixture-key');
    expect(store.get('app_config')).toEqual({ ...config, providers: { builtin_models: { apiKey: 'justdo-builtin-credential' } } });
  } finally { store.close(); }
});

test('converts existing plaintext credentials when opening a database', () => {
  const directory = createTempDir();
  const initial = SqliteStore.create(directory);
  const config = { providers: { builtin_models: { apiKey: 'legacy-builtin-fixture' } } };
  initial.getDatabase().prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)')
    .run('app_config', JSON.stringify(config), Date.now());
  initial.close();
  const reopened = SqliteStore.create(directory);
  try {
    const row = reopened.getDatabase().prepare('SELECT value FROM kv WHERE key = ?').get('app_config') as { value: string };
    expect(row.value).not.toContain('legacy-builtin-fixture');
    expect(reopened.get('app_config')).toEqual({ providers: { builtin_models: { apiKey: 'justdo-builtin-credential' } } });
  } finally { reopened.close(); }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deletes legacy schema database and creates a fresh database', () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, DB_FILENAME);
  const db = new BetterSqlite3(dbPath);
  const now = Date.now();

  db.exec(`
    CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      cwd TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    );
  `);
  db.prepare(
    `INSERT INTO cowork_sessions (id, title, status, cwd, created_at, updated_at)
     VALUES ('legacy-session', 'legacy', 'idle', '/tmp', ?, ?)`,
  ).run(now, now);
  db.close();

  const store = SqliteStore.create(dir);
  const migratedDb = store.getDatabase();
  const columns = migratedDb.pragma('table_info(cowork_sessions)') as Array<{ name: string }>;
  const indexes = migratedDb.pragma('index_list(cowork_sessions)') as Array<{ name: string }>;
  const legacyRow = migratedDb
    .prepare("SELECT id FROM cowork_sessions WHERE id = 'legacy-session'")
    .get();
  const resultTable = migratedDb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scheduled_task_run_receipts'",
    )
    .get();
  const resultColumns = migratedDb.pragma('table_info(scheduled_task_run_receipts)') as Array<{
    name: string;
  }>;
  const cleanupTable = migratedDb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scheduled_task_result_cleanup'",
    )
    .get();
  const tombstoneTable = migratedDb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scheduled_task_result_tombstones'",
    )
    .get();
  const sessionRunsTable = migratedDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cowork_session_runs'")
    .get();
  const sessionSegmentsTable = migratedDb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cowork_session_segments'",
    )
    .get();
  const messageCacheTable = migratedDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cowork_messages'")
    .get();

  expect(columns.map(column => column.name)).toEqual(
    expect.arrayContaining(['agent_id', 'group_id', 'pinned', 'active_skill_ids', 'model_ref']),
  );
  expect(columns.map(column => column.name)).not.toContain('claude_session_id');
  expect(indexes.map(index => index.name)).toContain('idx_cowork_sessions_agent_order');
  expect(legacyRow).toBeUndefined();
  expect(resultTable).toEqual({ name: 'scheduled_task_run_receipts' });
  expect(resultColumns.map(column => column.name)).toContain('system_managed');
  expect(cleanupTable).toEqual({ name: 'scheduled_task_result_cleanup' });
  expect(tombstoneTable).toEqual({ name: 'scheduled_task_result_tombstones' });
  expect(sessionRunsTable).toEqual({ name: 'cowork_session_runs' });
  expect(sessionSegmentsTable).toEqual({ name: 'cowork_session_segments' });
  expect(messageCacheTable).toBeUndefined();

  store.close();
});

test('adds model_ref, keeps product sessions, and removes the redundant message cache', () => {
  const dir = createTempDir();
  const dbPath = path.join(dir, DB_FILENAME);
  const db = new BetterSqlite3(dbPath);
  const now = Date.now();

  db.exec(`
    CREATE TABLE cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      cwd TEXT NOT NULL,
      execution_mode TEXT,
      active_skill_ids TEXT,
      agent_id TEXT NOT NULL,
      group_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      sequence INTEGER,
      thinking_content TEXT,
      model_name TEXT,
      usage TEXT
    );
    CREATE TABLE scheduled_task_run_receipts (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      session_id TEXT,
      session_key TEXT,
      status TEXT NOT NULL,
      summary TEXT,
      error TEXT,
      delivery_status TEXT,
      delivery_error TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      duration_ms INTEGER,
      observed_at INTEGER NOT NULL,
      read_at INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO cowork_sessions
      (id, title, status, cwd, agent_id, created_at, updated_at)
     VALUES ('kept-session', 'kept', 'idle', '/tmp', 'main', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO cowork_messages
      (id, session_id, type, content, created_at, sequence)
     VALUES ('cached-message', 'kept-session', 'assistant', 'duplicate', ?, 1)`,
  ).run(now);
  db.prepare(
    `INSERT INTO scheduled_task_run_receipts
      (run_id, task_id, task_name, status, started_at, observed_at, updated_at)
     VALUES ('kept-result', 'task-1', 'Task', 'success', 1000, 1001, 1001)`,
  ).run();
  db.close();

  const store = SqliteStore.create(dir);
  const migratedDb = store.getDatabase();
  const columns = migratedDb.pragma('table_info(cowork_sessions)') as Array<{ name: string }>;
  const keptRow = migratedDb
    .prepare("SELECT id FROM cowork_sessions WHERE id = 'kept-session'")
    .get();
  const messageCacheTable = migratedDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cowork_messages'")
    .get();
  const resultColumns = migratedDb.pragma('table_info(scheduled_task_run_receipts)') as Array<{
    name: string;
  }>;
  const keptResult = migratedDb
    .prepare(
      "SELECT run_id, system_managed FROM scheduled_task_run_receipts WHERE run_id = 'kept-result'",
    )
    .get();

  expect(columns.map(column => column.name)).toContain('model_ref');
  expect(keptRow).toEqual({ id: 'kept-session' });
  expect(messageCacheTable).toBeUndefined();
  expect(resultColumns.map(column => column.name)).toContain('system_managed');
  expect(keptResult).toEqual({ run_id: 'kept-result', system_managed: 0 });
  store.close();

  const reopened = SqliteStore.create(dir);
  expect(
    reopened
      .getDatabase()
      .prepare(
        "SELECT run_id, system_managed FROM scheduled_task_run_receipts WHERE run_id = 'kept-result'",
      )
      .get(),
  ).toEqual({ run_id: 'kept-result', system_managed: 0 });
  reopened.close();
});

test('persists one idempotent user run and cascades it with the session', () => {
  const dir = createTempDir();
  const sqlite = SqliteStore.create(dir);
  const db = sqlite.getDatabase();
  db.prepare(
    `INSERT INTO cowork_sessions
      (id, title, status, cwd, agent_id, created_at, updated_at)
     VALUES ('session-1', 'Session', 'idle', '/tmp', 'main', 1, 1)`,
  ).run();
  const store = new CoworkStore(db);

  const first = store.beginSessionRun({
    sessionId: 'session-1',
    clientTurnId: 'turn-1',
    startedAt: 1_000,
    modelRef: 'openai/gpt-5',
  });
  const duplicate = store.beginSessionRun({
    sessionId: 'session-1',
    clientTurnId: 'turn-1',
    startedAt: 9_000,
  });
  expect(duplicate).toEqual(first);
  expect(first.rootRunId).toBe('turn-1');

  expect(store.finishSessionRun(first.id, 'completed', 6_000)).toMatchObject({
    startedAt: 1_000,
    endedAt: 6_000,
    state: 'completed',
  });
  db.prepare("DELETE FROM cowork_sessions WHERE id = 'session-1'").run();
  expect(store.getSessionRuns('session-1')).toEqual([]);
  sqlite.close();
});

test('rejects a client turn reused by another session and interrupts open runs on startup', () => {
  const dir = createTempDir();
  const sqlite = SqliteStore.create(dir);
  const db = sqlite.getDatabase();
  for (const id of ['session-1', 'session-2']) {
    db.prepare(
      `INSERT INTO cowork_sessions
        (id, title, status, cwd, agent_id, created_at, updated_at)
       VALUES (?, 'Session', 'idle', '/tmp', 'main', 1, 1)`,
    ).run(id);
  }
  const store = new CoworkStore(db);
  const timing = store.beginSessionRun({
    sessionId: 'session-1',
    clientTurnId: 'turn-1',
    startedAt: 1_000,
  });

  expect(() =>
    store.beginSessionRun({
      sessionId: 'session-2',
      clientTurnId: 'turn-1',
      startedAt: 2_000,
    }),
  ).toThrow('another session');

  expect(store.interruptOpenSessionRuns(10_000)).toBe(1);
  expect(store.getSessionRun(timing.id)).toMatchObject({
    startedAt: 10_000,
    acceptedAt: 10_000,
    endedAt: 10_000,
    state: 'aborted',
  });
  expect(store.interruptOpenSessionRuns(11_000)).toBe(0);
  expect(store.reopenSessionRun(timing.id)).toMatchObject({
    startedAt: 10_000,
    acceptedAt: 10_000,
    state: 'running',
  });
  expect(store.getSessionRun(timing.id)).toEqual(
    expect.not.objectContaining({ endedAt: expect.any(Number) }),
  );
  sqlite.close();
});

test('persists ordered execution segments without copying gateway messages', () => {
  const dir = createTempDir();
  const sqlite = SqliteStore.create(dir);
  const db = sqlite.getDatabase();
  db.prepare(
    `INSERT INTO cowork_sessions
      (id, title, status, cwd, agent_id, created_at, updated_at)
     VALUES ('session-segments', 'Session', 'idle', '/tmp', 'main', 1, 1)`,
  ).run();
  const store = new CoworkStore(db);

  const planning = store.beginSessionSegment({
    id: 'segment-plan',
    sessionId: 'session-segments',
    sessionKey: 'agent:main:justdo:session-segments:execution:plan-1',
    phase: 'planning',
    planId: 'plan-1',
    startedAt: 1_000,
  });
  expect(planning).toMatchObject({ ordinal: 0, phase: 'planning', planId: 'plan-1' });
  expect(
    store.beginSessionSegment({
      id: 'segment-plan',
      sessionId: 'session-segments',
      sessionKey: planning.sessionKey,
      phase: 'planning',
      planId: 'plan-1',
      startedAt: 9_000,
    }),
  ).toEqual(planning);
  expect(() =>
    store.beginSessionSegment({
      id: 'another-active',
      sessionId: 'session-segments',
      sessionKey: 'agent:main:justdo:session-segments:execution:other',
      phase: 'conversation',
      startedAt: 1_500,
    }),
  ).toThrow('active execution segment');

  const implementation = store.transitionSessionSegment({
    id: 'segment-implementation',
    sessionId: 'session-segments',
    sessionKey: 'agent:main:justdo:session-segments:execution:implementation-1',
    gatewaySessionId: 'gateway-implementation',
    phase: 'implementation',
    planId: 'plan-1',
    startedAt: 2_000,
  });

  expect(store.listSessionSegments('session-segments')).toMatchObject([
    { id: 'segment-plan', ordinal: 0, endedAt: 2_000 },
    {
      id: 'segment-implementation',
      ordinal: 1,
      gatewaySessionId: 'gateway-implementation',
    },
  ]);
  expect(store.getActiveSessionSegment('session-segments')).toEqual(implementation);
  expect(() =>
    store.bindSessionSegmentGatewaySession('segment-implementation', 'gateway-2', 2_500),
  ).toThrow('already bound to another Gateway session');
  expect(
    store.bindSessionSegmentGatewaySession(
      'segment-implementation',
      'gateway-implementation',
      2_500,
    ),
  ).toMatchObject({ gatewaySessionId: 'gateway-implementation', updatedAt: 2_500 });

  db.prepare("DELETE FROM cowork_sessions WHERE id = 'session-segments'").run();
  expect(store.listSessionSegments('session-segments')).toEqual([]);
  expect(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cowork_messages'")
      .get(),
  ).toBeUndefined();
  sqlite.close();
});

test('persists and atomically admits recoverable plan handoffs', () => {
  const dir = createTempDir();
  const sqlite = SqliteStore.create(dir);
  const db = sqlite.getDatabase();
  db.prepare(
    `INSERT INTO cowork_sessions
      (id, title, status, cwd, agent_id, created_at, updated_at)
     VALUES ('session-plan', 'Session', 'idle', '/tmp', 'main', 1, 1)`,
  ).run();
  const store = new CoworkStore(db);
  const workspaceRoot = path.resolve('/tmp');
  store.beginSessionSegment({
    id: 'planning-segment',
    sessionId: 'session-plan',
    sessionKey: 'agent:main:justdo:session-plan',
    phase: 'planning',
    planId: 'plan-1',
    startedAt: 1_000,
  });

  const artifact = {
    sessionId: 'session-plan',
    planId: 'plan-1',
    workspaceRoot,
    relativePath: path.join(`.${PRODUCT_NAME_LOWERCASE}`, 'plans', 'session-plan', 'plan-1.md'),
    sha256: 'a'.repeat(64),
    byteLength: 42,
  };
  const presented = store.createPlanHandoff({
    sessionId: 'session-plan',
    planId: 'plan-1',
    planningSessionKey: 'agent:main:justdo:session-plan',
    artifact,
    presentedAt: 1_100,
  });
  expect(presented).toMatchObject({ state: CoworkPlanHandoffState.Presented, artifact });
  expect(
    store.createPlanHandoff({
      sessionId: 'session-plan',
      planId: 'plan-1',
      planningSessionKey: 'agent:main:justdo:session-plan',
      artifact,
      presentedAt: 9_999,
    }),
  ).toEqual(presented);

  const implementationSessionKey = 'agent:main:justdo:session-plan:execution:plan-1';
  expect(
    store.transitionPlanHandoff({
      planId: 'plan-1',
      expectedState: CoworkPlanHandoffState.Presented,
      nextState: CoworkPlanHandoffState.Dispatching,
      implementationSessionKey,
      transitionedAt: 1_200,
    }),
  ).toMatchObject({
    state: CoworkPlanHandoffState.Dispatching,
    implementationSessionKey,
    dispatchStartedAt: 1_200,
  });

  const admitted = store.admitPlanHandoffAndTransitionSegment({
    planId: 'plan-1',
    expectedState: CoworkPlanHandoffState.Dispatching,
    implementationGatewaySessionId: 'gateway-session-1',
    implementationRunId: 'run-1',
    implementationSegment: {
      id: 'implementation-segment',
      sessionId: 'session-plan',
      sessionKey: implementationSessionKey,
      phase: 'implementation',
      planId: 'plan-1',
      startedAt: 1_300,
    },
    admittedAt: 1_300,
  });
  expect(admitted.handoff).toMatchObject({
    state: CoworkPlanHandoffState.Admitted,
    implementationGatewaySessionId: 'gateway-session-1',
    implementationRunId: 'run-1',
  });
  expect(admitted.segment).toMatchObject({
    id: 'implementation-segment',
    ordinal: 1,
    gatewaySessionId: 'gateway-session-1',
  });
  expect(store.listRecoverablePlanHandoffs()).toHaveLength(1);
  expect(store.listSessionSegments('session-plan')[0]).toMatchObject({ endedAt: 1_300 });

  expect(
    store.transitionPlanHandoff({
      planId: 'plan-1',
      expectedState: CoworkPlanHandoffState.Admitted,
      nextState: CoworkPlanHandoffState.Resolved,
      transitionedAt: 1_400,
    }),
  ).toMatchObject({ state: CoworkPlanHandoffState.Resolved, resolvedAt: 1_400 });
  expect(store.listRecoverablePlanHandoffs()).toEqual([]);

  store.createPlanHandoff({
    sessionId: 'session-plan',
    planId: 'plan-2',
    planningSessionKey: 'agent:main:justdo:session-plan',
    artifact: {
      ...artifact,
      planId: 'plan-2',
      relativePath: path.join(`.${PRODUCT_NAME_LOWERCASE}`, 'plans', 'session-plan', 'plan-2.md'),
    },
    presentedAt: 1_500,
  });
  store.transitionPlanHandoff({
    planId: 'plan-2',
    expectedState: CoworkPlanHandoffState.Presented,
    nextState: CoworkPlanHandoffState.Failed,
    transitionedAt: 1_600,
    error: 'retryable failure',
  });
  expect(store.listRecoverablePlanHandoffs()).toEqual([
    expect.objectContaining({ planId: 'plan-2', state: CoworkPlanHandoffState.Failed }),
  ]);
  store.createPlanHandoff({
    sessionId: 'session-plan',
    planId: 'plan-3',
    planningSessionKey: 'agent:main:justdo:session-plan',
    artifact: {
      ...artifact,
      planId: 'plan-3',
      relativePath: path.join(`.${PRODUCT_NAME_LOWERCASE}`, 'plans', 'session-plan', 'plan-3.md'),
    },
    presentedAt: 1_700,
  });
  store.transitionPlanHandoff({
    planId: 'plan-3',
    expectedState: CoworkPlanHandoffState.Presented,
    nextState: CoworkPlanHandoffState.Resolved,
    transitionedAt: 1_800,
  });
  expect(store.listRecoverablePlanHandoffs()).toEqual([]);
  expect(
    store.transitionPlanHandoff({
      planId: 'plan-2',
      expectedState: CoworkPlanHandoffState.Failed,
      nextState: CoworkPlanHandoffState.Resolved,
      transitionedAt: 1_900,
    }),
  ).toMatchObject({ state: CoworkPlanHandoffState.Resolved });

  db.prepare("DELETE FROM cowork_sessions WHERE id = 'session-plan'").run();
  expect(store.getPlanHandoff('plan-1')).toBeUndefined();
  sqlite.close();
});

test('migrates a legacy plan handoff to a workspace-bound artifact', () => {
  const dir = createTempDir();
  const sqlite = SqliteStore.create(dir);
  const db = sqlite.getDatabase();
  db.prepare(
    `INSERT INTO cowork_sessions
      (id, title, status, cwd, agent_id, created_at, updated_at)
     VALUES ('session-plan', 'Session', 'idle', '/tmp', 'main', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO cowork_plan_handoffs
      (plan_id, session_id, planning_session_key, artifact_relative_path,
       artifact_sha256, artifact_byte_length, state, presented_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'presented', ?, ?, ?)`,
  ).run(
    'plan-legacy',
    'session-plan',
    'agent:main:justdo:session-plan',
    path.join('plans', 'v1', 'session-plan', 'plan-legacy.md'),
    'c'.repeat(64),
    10,
    1,
    1,
    1,
  );
  const store = new CoworkStore(db);
  expect(store.getPlanHandoff('plan-legacy')?.artifact.workspaceRoot).toBeUndefined();
  const workspaceRoot = path.resolve('/tmp');
  const migrated = store.migratePlanHandoffArtifact('plan-legacy', {
    sessionId: 'session-plan',
    planId: 'plan-legacy',
    workspaceRoot,
    relativePath: path.join(
      `.${PRODUCT_NAME_LOWERCASE}`,
      'plans',
      'session-plan',
      'plan-legacy.md',
    ),
    sha256: 'c'.repeat(64),
    byteLength: 10,
  });

  expect(migrated.artifact.workspaceRoot).toBe(workspaceRoot);
  expect(() => store.migratePlanHandoffArtifact('plan-legacy', migrated.artifact)).toThrow(
    'lost its expected state',
  );
  sqlite.close();
});

test('rolls back the segment switch when plan admission loses its state fence', () => {
  const dir = createTempDir();
  const sqlite = SqliteStore.create(dir);
  const db = sqlite.getDatabase();
  db.prepare(
    `INSERT INTO cowork_sessions
      (id, title, status, cwd, agent_id, created_at, updated_at)
     VALUES ('session-plan', 'Session', 'idle', '/tmp', 'main', 1, 1)`,
  ).run();
  const store = new CoworkStore(db);
  const workspaceRoot = path.resolve('/tmp');
  store.beginSessionSegment({
    id: 'planning-segment',
    sessionId: 'session-plan',
    sessionKey: 'agent:main:justdo:session-plan',
    phase: 'planning',
    startedAt: 1_000,
  });
  store.createPlanHandoff({
    sessionId: 'session-plan',
    planId: 'plan-1',
    planningSessionKey: 'agent:main:justdo:session-plan',
    artifact: {
      sessionId: 'session-plan',
      planId: 'plan-1',
      workspaceRoot,
      relativePath: path.join(`.${PRODUCT_NAME_LOWERCASE}`, 'plans', 'session-plan', 'plan-1.md'),
      sha256: 'b'.repeat(64),
      byteLength: 10,
    },
    presentedAt: 1_100,
  });
  const implementationSessionKey = 'agent:main:justdo:session-plan:execution:plan-1';
  store.transitionPlanHandoff({
    planId: 'plan-1',
    expectedState: CoworkPlanHandoffState.Presented,
    nextState: CoworkPlanHandoffState.Dispatching,
    implementationSessionKey,
    transitionedAt: 1_200,
  });
  db.exec(`
    CREATE TRIGGER reject_test_plan_admission
    BEFORE UPDATE OF state ON cowork_plan_handoffs
    WHEN NEW.state = 'admitted'
    BEGIN
      SELECT RAISE(ABORT, 'forced admission failure');
    END;
  `);

  expect(() =>
    store.admitPlanHandoffAndTransitionSegment({
      planId: 'plan-1',
      expectedState: CoworkPlanHandoffState.Dispatching,
      implementationGatewaySessionId: 'gateway-session-1',
      implementationRunId: 'run-1',
      implementationSegment: {
        id: 'implementation-segment',
        sessionId: 'session-plan',
        sessionKey: implementationSessionKey,
        phase: 'implementation',
        startedAt: 1_300,
      },
      admittedAt: 1_300,
    }),
  ).toThrow('forced admission failure');
  expect(store.getActiveSessionSegment('session-plan')).toMatchObject({ id: 'planning-segment' });
  expect(store.getPlanHandoff('plan-1')).toMatchObject({
    state: CoworkPlanHandoffState.Dispatching,
  });
  sqlite.close();
});
