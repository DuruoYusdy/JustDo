import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
import { CollaborationStore, initializeCollaborationTables } from '../../data/collaborationStore';
import type { CoworkStore } from '../../data/coworkStore';
import type { CoworkEngineRouter } from '../../engine';
import { CollaborationCoordinator } from './collaboration';

let db: Database.Database;
let metadata: CollaborationStore;
let coordinator: CollaborationCoordinator;
const request = vi.fn();
const start = vi.fn();
const stop = vi.fn();
const runtimeStatus = vi.fn();
const prepare = vi.fn();
const notifyChanged = vi.fn();
const onSessionDeleted = vi.fn();
const createAssistant = vi.fn();
const key = (id: string) => `agent:${id}:justdo:${id}`;
beforeEach(() => {
  vi.useFakeTimers();
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, enabled INTEGER);
    CREATE TABLE cowork_sessions (id TEXT PRIMARY KEY, agent_id TEXT, status TEXT);
    INSERT INTO agents VALUES ('a',1),('b',1),('c',1);
    INSERT INTO cowork_sessions VALUES ('a','a','idle'),('b','b','idle'),('c','c','idle');`);
  initializeCollaborationTables(db);
  metadata = new CollaborationStore(db);
  metadata.createRoom({
    id: 'room',
    anchorSessionId: 'a',
    members: ['a', 'b', 'c'].map(agentId => ({
      agentId,
      sessionId: agentId,
      sessionKey: key(agentId),
    })),
  });
  notifyChanged.mockReset();
  onSessionDeleted.mockReset();
  createAssistant.mockReset().mockImplementation(async (_input, _identity, assertActive) => {
    assertActive();
    return { status: 'created', agentId: 'new-agent' };
  });
  prepare.mockReset().mockResolvedValue(undefined);
  request.mockReset().mockResolvedValue({ ok: true });
  start.mockReset().mockResolvedValue(undefined);
  stop.mockReset().mockResolvedValue(undefined);
  runtimeStatus.mockReset().mockResolvedValue({ known: true, running: false });
  const store = {
    getSession: (id: string) =>
      db
        .prepare('SELECT id, agent_id AS agentId, status FROM cowork_sessions WHERE id = ?')
        .get(id),
    createSession: (
      _title: string,
      _cwd: string,
      _mode: string,
      _skills: unknown,
      agentId: string,
    ) => {
      const id = `peer-${agentId}`;
      db.prepare('INSERT INTO cowork_sessions VALUES (?, ?, ?)').run(id, agentId, 'idle');
      return { id };
    },
    deleteSession: (id: string) => db.prepare('DELETE FROM cowork_sessions WHERE id = ?').run(id),
    listPlanHandoffs: (id: string) => [{ artifact: { workspaceRoot: `workspace-${id}` } }],
    listAgents: () => db.prepare('SELECT id, enabled, id AS name FROM agents').all(),
    getAgent: (id: string) =>
      db.prepare('SELECT id, enabled, id AS name FROM agents WHERE id = ?').get(id),
    getSessionRuns: (id: string) =>
      id === 'a'
        ? [{ clientTurnId: 'user-turn', rootRunId: 'user-run', state: 'running' }]
        : id === 'c'
          ? [{ clientTurnId: 'other-turn', rootRunId: 'other-run' }]
          : [],
  } as unknown as CoworkStore;
  const router = {
    prepareSession: prepare,
    startSession: start,
    stopSession: stop,
    getSessionRuntimeStatus: runtimeStatus,
    onSessionDeleted,
  } as unknown as CoworkEngineRouter;
  coordinator = new CollaborationCoordinator({
    onSessionsChanged: notifyChanged,
    createAssistant,
    getDatabase: () => db,
    getStore: () => store,
    getRouter: () => router,
    getRuntime: () => null,
    requestGateway: request,
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  db.close();
});
const ensure = (from = 'a', agentId = 'b', runId = 'user-run', call = 'call') =>
  coordinator.handle({
    requestId: call,
    operation: 'ensure',
    sessionKey: key(from),
    sourceRunId: runId,
    toolCallId: call,
    expiresAt: Date.now() + 8000,
    input: { agentId },
  });

describe('peer execution coordination', () => {
  it('reads only room-owned delivery messages through the native lookup', async () => {
    metadata.beginRound('room', 'round');
    const delivery = metadata.enqueue('room', 'round', key('a'), 'call', 'run', {
      to: 'b',
      message: 'Review these changes',
    });
    request.mockResolvedValueOnce({
      messages: [{ deliveryId: delivery.id, message: { role: 'user', content: 'Review' } }],
    });

    await expect(coordinator.readMessages('a', [delivery.id])).resolves.toEqual([
      { deliveryId: delivery.id, message: { role: 'user', content: 'Review' } },
    ]);
    expect(request).toHaveBeenLastCalledWith('collaboration.messages', {
      lookups: [
        expect.objectContaining({
          deliveryId: delivery.id,
          receiptId: delivery.id,
          sessionId: 'b',
          sessionKey: key('b'),
          sourceSessionKey: key('a'),
        }),
      ],
    });
    await expect(coordinator.readMessages('a', ['foreign'])).rejects.toThrow(
      'collaborationInvalidMessage',
    );
  });
  it('shows an expired native acknowledgement as unknown instead of retrying the send', async () => {
    await coordinator.handle({
      requestId: 'send',
      operation: 'native-send',
      sessionKey: key('a'),
      sourceRunId: 'user-run',
      toolCallId: 'send',
      input: { sessionKey: key('b'), message: 'Review' },
    });
    await vi.advanceTimersByTimeAsync(61000);
    expect(coordinator.read('a').deliveries[0].state).toBe('unknown');
    expect(start).not.toHaveBeenCalled();
  });
  it('records native admission and allows its recipient to reply in the same round', async () => {
    await coordinator.handle({
      requestId: 'send',
      operation: 'native-send',
      sessionKey: key('a'),
      sourceRunId: 'user-run',
      toolCallId: 'send',
      input: { sessionKey: key('b'), message: 'Review' },
    });
    const delivery = coordinator.read('a').deliveries[0];
    expect(delivery.state).toBe('dispatching');
    expect(start).not.toHaveBeenCalled();
    await coordinator.handle({
      requestId: 'receipt',
      operation: 'native-result',
      sessionKey: key('a'),
      sourceRunId: 'user-run',
      toolCallId: 'send',
      input: { deliveryId: delivery.id, status: 'accepted', runId: 'native-peer-run' },
    });
    await coordinator.handle({
      requestId: 'reply',
      operation: 'native-send',
      sessionKey: key('b'),
      sourceRunId: 'native-peer-run',
      toolCallId: 'reply',
      input: { sessionKey: key('a'), message: 'Reviewed' },
    });
    expect(coordinator.read('a').deliveries.map(item => item.roundId)).toEqual([
      'user-turn',
      'user-turn',
    ]);
    await coordinator.handle({
      requestId: 'foreign',
      operation: 'native-send',
      sessionKey: key('a'),
      sourceRunId: 'user-run',
      toolCallId: 'foreign',
      input: { sessionKey: 'agent:b:justdo:elsewhere', message: 'No' },
    });
    expect(request).toHaveBeenLastCalledWith('collaboration.resolve', {
      requestId: 'foreign',
      result: { error: 'collaborationInvalidRecipient' },
    });
  });
  it('accepts a fast native recipient reply while the sender acknowledgement is in flight', async () => {
    await coordinator.handle({
      requestId: 'send',
      operation: 'native-send',
      sessionKey: key('a'),
      sourceRunId: 'user-run',
      toolCallId: 'send',
      expiresAt: Date.now() + 8000,
      input: { sessionKey: key('b'), message: 'Review' },
    });
    const delivery = coordinator.read('a').deliveries[0];
    const reply = coordinator.handle({
      requestId: 'reply',
      operation: 'native-send',
      sessionKey: key('b'),
      sourceRunId: 'native-peer-run',
      toolCallId: 'reply',
      expiresAt: Date.now() + 8000,
      input: { sessionKey: key('a'), message: 'Reviewed' },
    });
    await Promise.resolve();
    await coordinator.handle({
      requestId: 'receipt',
      operation: 'native-result',
      sessionKey: key('a'),
      sourceRunId: 'user-run',
      toolCallId: 'send',
      expiresAt: Date.now() + 8000,
      input: { deliveryId: delivery.id, status: 'accepted', runId: 'native-peer-run' },
    });
    await reply;

    expect(coordinator.read('a').deliveries.map(item => item.roundId)).toEqual([
      'user-turn',
      'user-turn',
    ]);
    expect(request).toHaveBeenCalledWith(
      'collaboration.resolve',
      expect.objectContaining({
        requestId: 'reply',
        result: expect.objectContaining({ sessionKey: key('a') }),
      }),
    );
  });
  it('keeps the task frozen after partial deletion and retries only remaining native sessions', async () => {
    request.mockImplementation(async (method, input) => {
      if (method === 'sessions.delete' && input.key === key('b'))
        throw new Error('Gateway offline');
      return { ok: true };
    });
    await expect(coordinator.deleteTask('a')).rejects.toThrow('Gateway offline');
    expect(coordinator.read('a').room?.deleting).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cowork_sessions').get()).toEqual({ n: 3 });
    request.mockClear().mockResolvedValue({ ok: true });
    runtimeStatus.mockImplementation(async id => ({ known: id !== 'a', running: false }));
    await expect(coordinator.deleteTask('a')).resolves.toBe(true);
    expect(
      request.mock.calls.filter(call => call[0] === 'sessions.delete').map(call => call[1].key),
    ).toEqual([key('b'), key('c')]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cowork_sessions').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM agents').get()).toEqual({ n: 3 });
    for (const id of ['a', 'b', 'c']) {
      expect(onSessionDeleted).toHaveBeenCalledWith(id, id, [key(id)], [`workspace-${id}`]);
    }
  });
  it('exposes native creation only to a live main-conversation call', async () => {
    await coordinator.handle({
      requestId: 'create',
      operation: 'create',
      sessionKey: key('a'),
      sourceRunId: 'user-run',
      toolCallId: 'create-call',
      input: { name: 'Review' },
    });
    expect(createAssistant).toHaveBeenCalledWith(
      { name: 'Review' },
      JSON.stringify([key('a'), 'user-run', 'create-call']),
      expect.any(Function),
    );
    expect(request).toHaveBeenCalledWith('collaboration.resolve', {
      requestId: 'create',
      result: { status: 'created', agentId: 'new-agent' },
    });
    createAssistant.mockClear();
    await coordinator.handle({
      requestId: 'blocked',
      operation: 'create',
      sessionKey: key('b'),
      sourceRunId: 'user-run',
      toolCallId: 'create-call',
      input: {},
    });
    expect(createAssistant).not.toHaveBeenCalled();
  });
  it('lets a nested main turn prepare the next peer in the same collaboration round', async () => {
    db.prepare("DELETE FROM collaboration_members WHERE agent_id = 'c'").run();
    metadata.beginRound('room', 'user-turn');
    const inbound = metadata.enqueue('room', 'user-turn', key('b'), 'reply', 'peer-run', {
      to: 'a',
      message: 'Research is ready for review.',
    });
    metadata.transition(inbound.id, 'queued', 'dispatching');
    metadata.transition(inbound.id, 'dispatching', 'accepted', 'nested-main-run');

    await coordinator.handle({
      requestId: 'prepare-reviewer',
      operation: 'ensure',
      sessionKey: key('a'),
      sourceRunId: 'nested-main-run',
      toolCallId: 'prepare-reviewer',
      expiresAt: Date.now() + 8000,
      input: { agentId: 'c' },
    });

    expect(metadata.getRoom('room')!.members.map(member => member.agentId)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(prepare).toHaveBeenCalledWith('peer-c');
    expect(request).toHaveBeenLastCalledWith('collaboration.resolve', {
      requestId: 'prepare-reviewer',
      result: {
        member: { agentId: 'c', sessionId: 'peer-c', sessionKey: 'agent:c:justdo:peer-c' },
      },
    });
  });
  it('cancels initial setup when Stop occurs during native preparation', async () => {
    db.prepare('DELETE FROM collaboration_rooms').run();
    prepare.mockImplementationOnce(async () => {
      await coordinator.stop('a');
    });
    await ensure();
    expect(metadata.getRoomForSession('a')).toBeUndefined();
    expect(db.prepare("SELECT id FROM cowork_sessions WHERE id = 'peer-b'").get()).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
  });
  it('waits for native admission before a fast nested main turn recruits another peer', async () => {
    db.prepare("DELETE FROM collaboration_members WHERE agent_id = 'c'").run();
    metadata.beginRound('room', 'user-turn');
    const inbound = metadata.enqueue('room', 'user-turn', key('b'), 'reply', 'peer-run', {
      to: 'a',
      message: 'Ready for the next assistant.',
    });
    metadata.transition(inbound.id, 'queued', 'dispatching');

    const pending = ensure('a', 'c', 'nested-main-run', 'prepare-next');
    await Promise.resolve();
    expect(prepare).not.toHaveBeenCalled();
    await coordinator.handle({
      requestId: 'receipt',
      operation: 'native-result',
      sessionKey: key('b'),
      sourceRunId: 'peer-run',
      toolCallId: 'reply',
      input: { deliveryId: inbound.id, status: 'accepted', runId: 'nested-main-run' },
    });
    await pending;

    expect(prepare).toHaveBeenCalledWith('peer-c');
    expect(request).toHaveBeenLastCalledWith('collaboration.resolve', {
      requestId: 'prepare-next',
      result: {
        member: { agentId: 'c', sessionId: 'peer-c', sessionKey: 'agent:c:justdo:peer-c' },
      },
    });
  });
  it('cleans up failed native preparation and never publishes a fake member', async () => {
    db.prepare('DELETE FROM collaboration_rooms').run();
    prepare.mockRejectedValueOnce(new Error('unavailable'));
    await ensure();
    expect(metadata.listRooms()).toHaveLength(0);
    expect(request).toHaveBeenCalledWith('sessions.delete', { key: 'agent:b:justdo:peer-b' });
  });
  it('does not allow peers to recruit new assistants', async () => {
    db.prepare("DELETE FROM collaboration_members WHERE agent_id = 'c'").run();
    await ensure('b', 'c', 'peer-run');
    expect(prepare).not.toHaveBeenCalled();
    expect(metadata.getRoom('room')!.members).toHaveLength(2);
  });
  it('lists available assistants before a room exists without broadening Subagent permissions', async () => {
    db.prepare('DELETE FROM collaboration_rooms').run();
    await coordinator.handle({ requestId: 'lookup', operation: 'members', sessionKey: key('a') });
    expect(request).toHaveBeenCalledWith('collaboration.resolve', {
      requestId: 'lookup',
      result: {
        members: [],
        available: [
          { agentId: 'b', name: 'b' },
          { agentId: 'c', name: 'c' },
        ],
      },
    });
  });
});
