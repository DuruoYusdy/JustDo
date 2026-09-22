import type Database from 'better-sqlite3';

import type { ExternalSessionStatus } from '../../../shared/integrations/multica';

export interface MulticaExternalSession {
  externalSessionKey: string;
  coworkSessionId: string;
  agentId: string;
  openclawSessionKey: string;
  cwd: string;
  status: ExternalSessionStatus;
  createdAt: number;
  updatedAt: number;
}

interface ExternalSessionRow {
  external_session_key: string;
  cowork_session_id: string;
  agent_id: string;
  openclaw_session_key: string | null;
  cwd: string;
  status: ExternalSessionStatus;
  created_at: number;
  updated_at: number;
}

export class MulticaExternalSessionStore {
  constructor(private readonly db: Database.Database) {}

  get(externalSessionKey: string): MulticaExternalSession | null {
    const row = this.db
      .prepare(
        `SELECT external_session_key, cowork_session_id, agent_id, openclaw_session_key, cwd, status, created_at, updated_at
         FROM cowork_external_sessions
         WHERE source = 'multica' AND external_session_key = ?`,
      )
      .get(externalSessionKey) as ExternalSessionRow | undefined;
    return row ? this.map(row) : null;
  }

  wasDeleted(externalSessionKey: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM cowork_external_session_tombstones
           WHERE source = 'multica' AND external_session_key = ?`,
        )
        .get(externalSessionKey),
    );
  }

  create(input: {
    externalSessionKey: string;
    coworkSessionId: string;
    agentId: string;
    openclawSessionKey: string;
    cwd: string;
  }): MulticaExternalSession {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO cowork_external_sessions
           (source, external_session_key, cowork_session_id, agent_id, openclaw_session_key, cwd, status, created_at, updated_at)
         VALUES ('multica', ?, ?, ?, ?, ?, 'running', ?, ?)`,
      )
      .run(
        input.externalSessionKey,
        input.coworkSessionId,
        input.agentId,
        input.openclawSessionKey,
        input.cwd,
        now,
        now,
      );
    return { ...input, status: 'running', createdAt: now, updatedAt: now };
  }

  setStatus(externalSessionKey: string, status: ExternalSessionStatus): void {
    this.db
      .prepare(
        `UPDATE cowork_external_sessions SET status = ?, updated_at = ?
         WHERE source = 'multica' AND external_session_key = ?`,
      )
      .run(status, Date.now(), externalSessionKey);
  }

  setOpenClawSessionKey(externalSessionKey: string, sessionKey: string): void {
    this.db
      .prepare(
        `UPDATE cowork_external_sessions SET openclaw_session_key = ?, updated_at = ?
         WHERE source = 'multica' AND external_session_key = ?`,
      )
      .run(sessionKey, Date.now(), externalSessionKey);
  }

  resetRunning(): number {
    return this.db
      .prepare(
        `UPDATE cowork_external_sessions SET status = 'cancelled', updated_at = ?
         WHERE source = 'multica' AND status = 'running'`,
      )
      .run(Date.now()).changes;
  }

  private map(row: ExternalSessionRow): MulticaExternalSession {
    return {
      externalSessionKey: row.external_session_key,
      coworkSessionId: row.cowork_session_id,
      agentId: row.agent_id,
      openclawSessionKey: row.openclaw_session_key ?? '',
      cwd: row.cwd,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
