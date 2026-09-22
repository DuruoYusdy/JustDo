import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  COLLABORATION_MESSAGE_BUDGET,
  type CollaborationRoom,
} from '../../shared/cowork/collaboration';
import { CollaborationStore, initializeCollaborationTables } from './collaborationStore';

const room: CollaborationRoom = {
  id: 'room',
  anchorSessionId: 'session-a',
  members: ['a', 'b', 'c'].map(agentId => ({
    agentId,
    sessionId: `session-${agentId}`,
    sessionKey: `agent:${agentId}:justdo:session-${agentId}`,
  })),
};
let db: Database.Database;
let store: CollaborationStore;
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, enabled INTEGER);
    CREATE TABLE cowork_sessions (id TEXT PRIMARY KEY, agent_id TEXT, status TEXT);
    INSERT INTO agents VALUES ('a',1),('b',1),('c',1);
    INSERT INTO cowork_sessions VALUES ('session-a','a','idle'),('session-b','b','idle'),('session-c','c','idle');`);
  initializeCollaborationTables(db);
  store = new CollaborationStore(db);
  store.createRoom(room);
  store.beginRound(room.id, 'turn');
});
afterEach(() => db.close());
const send = (call = 'call', message = 'Review the change') =>
  store.enqueue(room.id, 'turn', room.members[0].sessionKey, call, 'source-run', {
    to: 'b',
    message,
  });

describe('peer collaboration metadata', () => {
  it('keeps independent native sessions and accepts directed replies without a spawn relationship', () => {
    const outbound = send();
    store.transition(outbound.id, 'queued', 'dispatching');
    store.transition(outbound.id, 'dispatching', 'accepted', 'native-run');
    const reply = store.enqueue(
      room.id,
      'turn',
      room.members[1].sessionKey,
      'reply',
      'source-run',
      {
        to: 'a',
        message: 'Review complete',
        inReplyTo: outbound.id,
      },
    );
    expect(reply).toMatchObject({ from: 'b', to: 'a', inReplyTo: outbound.id, state: 'queued' });
    expect(store.getRoomForSession('session-c')?.id).toBe(room.id);
  });

  it('rejects forged source fields, non-members, self-send and undelivered reply references', () => {
    expect(() =>
      store.enqueue('room', 'turn', room.members[0].sessionKey, 'x', 'source-run', {
        from: 'c',
        to: 'b',
        message: 'forged',
      }),
    ).toThrow('collaborationInvalidMessage');
    expect(() =>
      store.enqueue('room', 'turn', 'agent:a:justdo:other', 'x', 'source-run', {
        to: 'b',
        message: 'outside room',
      }),
    ).toThrow('collaborationInvalidRecipient');
    expect(() =>
      store.enqueue('room', 'turn', room.members[0].sessionKey, 'x', 'source-run', {
        to: 'a',
        message: 'self',
      }),
    ).toThrow('collaborationInvalidRecipient');
    const queued = send();
    expect(() =>
      store.enqueue('room', 'turn', room.members[1].sessionKey, 'reply', 'source-run', {
        to: 'a',
        message: 'reply',
        inReplyTo: queued.id,
      }),
    ).toThrow('collaborationInvalidReply');
  });

  it('reuses the receipt for identical retries and rejects changed inputs without retaining message bodies', () => {
    const first = send();
    expect(send().id).toBe(first.id);
    expect(() => send('call', 'Changed payload')).toThrow('collaborationDuplicateConflict');
    expect(store.listDeliveries('room')).toHaveLength(1);
    const raw = db.prepare('SELECT * FROM collaboration_deliveries').get();
    expect(JSON.stringify(raw)).not.toContain('Review the change');
  });

  it('scopes tool-call identity to its native run and keeps accepted receipts immutable', () => {
    const first = send();
    const otherRun = store.enqueue(
      'room',
      'turn',
      room.members[0].sessionKey,
      'call',
      'other-run',
      {
        to: 'b',
        message: 'Review the change',
      },
    );
    expect(otherRun.id).not.toBe(first.id);
    const dispatched = store.transition(first.id, 'queued', 'dispatching');
    expect(dispatched.updatedAt).toBeGreaterThan(first.updatedAt);
    store.transition(first.id, 'dispatching', 'accepted', 'native-run');
    expect(() => store.transition(first.id, 'accepted', 'accepted', 'different-run')).toThrow();
    expect(store.getDelivery(first.id)?.runId).toBe('native-run');
  });

  it('persists the per-user-turn budget across store recreation and counts failed attempts', () => {
    for (let index = 0; index < COLLABORATION_MESSAGE_BUDGET; index++) {
      const delivery = send(`call-${index}`);
      store.transition(delivery.id, 'queued', 'failed');
    }
    store = new CollaborationStore(db);
    store.beginRound('room', 'turn');
    expect(() => send('excess')).toThrow('collaborationBudgetExceeded');
    expect(send('call-0').state).toBe('failed');
  });

  it('fails closed after deletion or disabling of a peer', () => {
    db.prepare("UPDATE agents SET enabled = 0 WHERE id = 'b'").run();
    expect(() => send()).toThrow('collaborationInvalidMembers');
    db.prepare("UPDATE agents SET enabled = 1 WHERE id = 'b'").run();
    db.prepare("DELETE FROM cowork_sessions WHERE id = 'session-b'").run();
    expect(() => send()).toThrow('collaborationInvalidRecipient');
  });

  it('recovers interrupted admission as unknown and never returns it to a send queue', () => {
    const uncertain = send();
    store.transition(uncertain.id, 'queued', 'dispatching');
    const queued = send('queued');
    store.recoverInterrupted();
    expect(store.getDelivery(uncertain.id)?.state).toBe('unknown');
    expect(store.getDelivery(queued.id)?.state).toBe('failed');
    expect(() => store.transition(uncertain.id, 'unknown', 'dispatching')).toThrow();
    expect(() => store.transition(uncertain.id, 'unknown', 'accepted')).toThrow();
    expect(store.transition(uncertain.id, 'unknown', 'accepted', 'verified-native-run').state).toBe(
      'accepted',
    );
  });

  it('rejects stale transitions rather than overwriting a newer native receipt', () => {
    const delivery = send();
    store.transition(delivery.id, 'queued', 'dispatching');
    expect(() => store.transition(delivery.id, 'queued', 'failed')).toThrow(
      'collaborationStateConflict',
    );
  });

  it('upgrades additively and cascades room deletion without deleting agent sessions', () => {
    initializeCollaborationTables(db);
    const delivery = send();
    store.transition(delivery.id, 'queued', 'dispatching');
    store.transition(delivery.id, 'dispatching', 'accepted', 'run');
    store.enqueue('room', 'turn', room.members[1].sessionKey, 'reply', 'source-run', {
      to: 'a',
      message: 'reply',
      inReplyTo: delivery.id,
    });
    db.prepare("DELETE FROM collaboration_rooms WHERE id = 'room'").run();
    expect(store.listDeliveries('room')).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM cowork_sessions').get()).toEqual({ count: 3 });
  });
});
