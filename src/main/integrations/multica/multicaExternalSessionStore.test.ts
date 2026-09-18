import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import { CoworkStore } from '../../data/coworkStore';
import { SqliteStore } from '../../data/sqliteStore';
import { MulticaExternalSessionStore } from './multicaExternalSessionStore';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('persists Multica session identity and projects read-only Cowork metadata', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-store-'));
  temporaryDirectories.push(userDataPath);
  const sqlite = SqliteStore.create(userDataPath);
  const cowork = new CoworkStore(sqlite.getDatabase());
  const external = new MulticaExternalSessionStore(sqlite.getDatabase());
  const session = cowork.createSession('External task', userDataPath);

  external.create({
    externalSessionKey: 'multica-1',
    coworkSessionId: session.id,
    agentId: 'main',
    openclawSessionKey: 'agent:main:multica:test',
    cwd: userDataPath,
  });
  external.setStatus('multica-1', 'completed');

  expect(external.get('multica-1')).toMatchObject({
    coworkSessionId: session.id,
    agentId: 'main',
    status: 'completed',
    openclawSessionKey: 'agent:main:multica:test',
  });
  expect(cowork.getSession(session.id)?.external).toEqual({
    origin: 'multica',
    readOnly: true,
    status: 'completed',
    sessionKey: 'agent:main:multica:test',
  });
  expect(cowork.listSessions()[0]?.external).toEqual({
    origin: 'multica',
    readOnly: true,
    status: 'completed',
    sessionKey: 'agent:main:multica:test',
  });

  cowork.deleteSession(session.id);
  expect(external.get('multica-1')).toBeNull();
  expect(external.wasDeleted('multica-1')).toBe(true);
  sqlite.close();
});

test('marks interrupted Multica work as cancelled during startup recovery', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-store-'));
  temporaryDirectories.push(userDataPath);
  const sqlite = SqliteStore.create(userDataPath);
  const cowork = new CoworkStore(sqlite.getDatabase());
  const external = new MulticaExternalSessionStore(sqlite.getDatabase());
  const session = cowork.createSession('Interrupted task', userDataPath);
  external.create({
    externalSessionKey: 'multica-running',
    coworkSessionId: session.id,
    agentId: 'main',
    openclawSessionKey: 'agent:main:multica:running',
    cwd: userDataPath,
  });

  expect(external.resetRunning()).toBe(1);
  expect(external.get('multica-running')?.status).toBe('cancelled');
  expect(external.resetRunning()).toBe(0);
  sqlite.close();
});

test('adds Agent and native session identity to an earlier Multica mapping schema', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-store-'));
  temporaryDirectories.push(userDataPath);
  const databasePath = path.join(userDataPath, 'justdo.sqlite');
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE cowork_external_sessions (
      source TEXT NOT NULL,
      external_session_key TEXT NOT NULL,
      cowork_session_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (source, external_session_key)
    );
  `);
  legacy.close();

  const sqlite = SqliteStore.create(userDataPath);
  const columns = sqlite
    .getDatabase()
    .prepare('PRAGMA table_info(cowork_external_sessions)')
    .all() as Array<{ name: string }>;

  expect(columns.map(column => column.name)).toContain('agent_id');
  expect(columns.map(column => column.name)).toContain('openclaw_session_key');
  sqlite.close();
});
