import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CoworkSession, CoworkStore } from '../../data/coworkStore';
import type { CoworkEngineRouter } from '../../engine';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { registerCoworkSessionExecutionHandlers } from './sessionExecution';

const session = (permissionMode: 'ask' | 'auto' | 'full'): CoworkSession => ({
  id: 'session-1',
  title: 'Session',
  status: 'idle',
  pinned: false,
  cwd: 'C:\\workspace',
  executionMode: 'local',
  permissionMode,
  activeSkillIds: [],
  agentId: 'main',
  createdAt: 1,
  updatedAt: 2,
});

describe('cowork session execution permissions', () => {
  beforeEach(() => handlers.clear());

  test('uses the persisted new-session default and ignores a renderer-supplied mode', async () => {
    const createSession = vi.fn().mockReturnValue(session('ask'));
    const store = {
      getConfig: () => ({
        workingDirectory: 'C:\\workspace',
        executionMode: 'local',
        agentEngine: 'openclaw',
        permissionMode: 'full',
      }),
      createSession,
      updateSession: vi.fn(),
      addMessage: vi.fn(),
      getSession: vi.fn().mockReturnValue(session('ask')),
      listAgents: () => [{ id: 'main', enabled: true, isDefault: true }],
      getAgent: vi.fn().mockReturnValue({ enabled: true, model: 'openai/gpt-5' }),
    } as unknown as CoworkStore;
    const startSession = vi.fn(
      (_sessionId: string, _prompt: string, options?: { onAccepted?: () => void }) => {
        options?.onAccepted?.();
        return new Promise<void>(() => undefined);
      },
    );
    registerCoworkSessionExecutionHandlers({
      ensureEngineRunning: vi.fn().mockResolvedValue({ phase: 'running' }),
      getCoworkStore: () => store,
      getCoworkEngineRouter: () => ({ startSession }) as unknown as CoworkEngineRouter,
      waitForConfigUpdates: vi.fn().mockResolvedValue(undefined),
      getEngineNotReadyResponse: vi.fn(),
    });

    const result = await handlers.get('cowork:session:start')?.(
      {},
      {
        prompt: 'hello',
        gatewayPrompt:
          '<<<EXTERNAL_UNTRUSTED_CONTENT id="0123456789abcdef">>>context<<<END_EXTERNAL_UNTRUSTED_CONTENT id="0123456789abcdef">>>\n\nhello',
        permissionMode: 'ask',
      },
    );
    expect(result).toMatchObject({ success: true });
    expect(createSession.mock.calls[0]?.[5]).toBe('full');
    // Legacy main profile models must not override the composer/application selection.
    expect(createSession.mock.calls[0]?.[6]).toBeUndefined();
    expect(startSession).toHaveBeenCalledWith(
      'session-1',
      '<<<EXTERNAL_UNTRUSTED_CONTENT id="0123456789abcdef">>>context<<<END_EXTERNAL_UNTRUSTED_CONTENT id="0123456789abcdef">>>\n\nhello',
      expect.objectContaining({ workspaceRoot: 'C:\\workspace' }),
    );
  });

  test('waits for queued config writes before reading the new-session default', async () => {
    let releaseConfig!: () => void;
    const waitForConfigUpdates = vi.fn(
      () =>
        new Promise<void>(resolve => {
          releaseConfig = resolve;
        }),
    );
    const ensureEngineRunning = vi.fn().mockResolvedValue({ phase: 'running' });
    const createSession = vi.fn().mockReturnValue(session('ask'));
    const store = {
      getConfig: () => ({
        workingDirectory: 'C:\\workspace',
        executionMode: 'local',
        agentEngine: 'openclaw',
        permissionMode: 'ask',
      }),
      createSession,
      updateSession: vi.fn(),
      addMessage: vi.fn(),
      getSession: vi.fn().mockReturnValue(session('ask')),
      listAgents: () => [{ id: 'main', enabled: true, isDefault: true }],
      getAgent: vi.fn().mockReturnValue({ enabled: true, model: '' }),
    } as unknown as CoworkStore;
    registerCoworkSessionExecutionHandlers({
      ensureEngineRunning,
      getCoworkStore: () => store,
      getCoworkEngineRouter: () =>
        ({ startSession: vi.fn().mockResolvedValue(undefined) }) as unknown as CoworkEngineRouter,
      waitForConfigUpdates,
      getEngineNotReadyResponse: vi.fn(),
    });

    const pending = handlers.get('cowork:session:start')?.(
      {},
      { prompt: 'hello', cwd: 'C:\\workspace', permissionMode: 'full' },
    ) as Promise<unknown>;
    await Promise.resolve();
    expect(ensureEngineRunning).not.toHaveBeenCalled();

    releaseConfig();
    await expect(pending).resolves.toMatchObject({ success: true });
    expect(createSession.mock.calls[0]?.[5]).toBe('ask');
  });

  test('replays a start request without creating or starting a second session', async () => {
    const existingSession = { ...session('ask'), status: 'running' as const };
    const existingTiming = {
      id: 'timing-1',
      sessionId: existingSession.id,
      clientTurnId: 'turn-1',
      rootRunId: 'run-1',
      startedAt: 1_000,
      state: 'running' as const,
    };
    const createSession = vi.fn();
    const startSession = vi.fn();
    const ensureEngineRunning = vi.fn();
    const store = {
      getSessionRunByClientTurnId: vi.fn().mockReturnValue(existingTiming),
      getSession: vi.fn().mockReturnValue(existingSession),
      createSession,
    } as unknown as CoworkStore;
    registerCoworkSessionExecutionHandlers({
      ensureEngineRunning,
      getCoworkStore: () => store,
      getCoworkEngineRouter: () => ({ startSession }) as unknown as CoworkEngineRouter,
      waitForConfigUpdates: vi.fn().mockResolvedValue(undefined),
      getEngineNotReadyResponse: vi.fn(),
    });

    await expect(
      handlers.get('cowork:session:start')?.(
        {},
        { prompt: 'hello', clientTurnId: 'turn-1', startedAt: 1_000 },
      ),
    ).resolves.toEqual({ success: true, session: existingSession, timing: existingTiming });
    expect(ensureEngineRunning).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  test('rejects an empty prompt before creating a session', async () => {
    const createSession = vi.fn();
    const store = {
      getSessionRunByClientTurnId: vi.fn(),
      createSession,
    } as unknown as CoworkStore;
    const ensureEngineRunning = vi.fn();
    registerCoworkSessionExecutionHandlers({
      ensureEngineRunning,
      getCoworkStore: () => store,
      getCoworkEngineRouter: () => ({}) as CoworkEngineRouter,
      waitForConfigUpdates: vi.fn(),
      getEngineNotReadyResponse: vi.fn(),
    });

    await expect(handlers.get('cowork:session:start')?.({}, { prompt: '   ' })).resolves.toEqual({
      success: false,
      error: 'Prompt is required.',
    });
    expect(ensureEngineRunning).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  test.each(['research', 'helper', 'unknown'])(
    'rejects non-main agent %s for user conversations',
    async agentId => {
      const ensureEngineRunning = vi.fn();
      registerCoworkSessionExecutionHandlers({
        ensureEngineRunning,
        getCoworkStore: () => ({}) as CoworkStore,
        getCoworkEngineRouter: () => ({}) as CoworkEngineRouter,
        waitForConfigUpdates: vi.fn(),
        getEngineNotReadyResponse: vi.fn(),
      });

      await expect(
        handlers.get('cowork:session:start')?.({}, { prompt: 'hello', agentId }),
      ).resolves.toEqual({
        success: false,
        error: 'agentUnavailable',
      });
      expect(ensureEngineRunning).not.toHaveBeenCalled();
    },
  );

  test('returns an asynchronous runtime admission failure and preserves the error state', async () => {
    const createdSession = { ...session('ask'), status: 'idle' as const };
    const updateSession = vi.fn((_sessionId: string, updates: Partial<CoworkSession>) =>
      Object.assign(createdSession, updates),
    );
    const store = {
      getConfig: () => ({
        workingDirectory: 'C:\\workspace',
        executionMode: 'local',
        permissionMode: 'ask',
      }),
      createSession: vi.fn().mockReturnValue(createdSession),
      updateSession,
      getSession: vi.fn().mockImplementation(() => createdSession),
      listAgents: () => [{ id: 'main', enabled: true, isDefault: true }],
      getAgent: vi.fn().mockReturnValue({ enabled: true, model: '' }),
    } as unknown as CoworkStore;
    registerCoworkSessionExecutionHandlers({
      ensureEngineRunning: vi.fn().mockResolvedValue({ phase: 'running' }),
      getCoworkStore: () => store,
      getCoworkEngineRouter: () =>
        ({
          startSession: vi.fn().mockRejectedValue(new Error('gateway unavailable')),
        }) as unknown as CoworkEngineRouter,
      waitForConfigUpdates: vi.fn().mockResolvedValue(undefined),
      getEngineNotReadyResponse: vi.fn(),
    });

    await expect(
      handlers.get('cowork:session:start')?.({}, { prompt: 'hello' }),
    ).resolves.toMatchObject({ success: false, error: 'gateway unavailable' });
    await vi.waitFor(() =>
      expect(updateSession).toHaveBeenCalledWith(createdSession.id, { status: 'error' }),
    );
    expect(createdSession.status).toBe('error');
  });
});

test.each([undefined, { enabled: false, model: '' }])(
  'rejects an unavailable selected role before persisting a session',
  async agent => {
    const createSession = vi.fn();
    registerCoworkSessionExecutionHandlers({
      ensureEngineRunning: vi.fn().mockResolvedValue({ phase: 'running' }),
      getCoworkStore: () =>
        ({
          getConfig: () => ({ workingDirectory: 'C:/project' }),
          getAgent: () => agent,
          createSession,
        }) as unknown as CoworkStore,
      getCoworkEngineRouter: () => ({ startSession: vi.fn() }) as unknown as CoworkEngineRouter,
      waitForConfigUpdates: async () => {},
      getEngineNotReadyResponse: vi.fn(),
    });
    await expect(
      handlers.get('cowork:session:start')?.({}, { prompt: 'hello', agentId: 'main' }),
    ).resolves.toMatchObject({ success: false, error: 'agentUnavailable' });
    expect(createSession).not.toHaveBeenCalled();
  },
);

test('uses main even when a specialist was previously configured as the default', async () => {
  const created = { ...session('ask'), agentId: 'main' };
  const createSession = vi.fn().mockReturnValue(created);
  const startSession = vi.fn().mockResolvedValue(undefined);
  registerCoworkSessionExecutionHandlers({
    ensureEngineRunning: vi.fn().mockResolvedValue({ phase: 'running' }),
    getCoworkStore: () =>
      ({
        getConfig: () => ({ workingDirectory: 'C:/project' }),
        listAgents: () => [{ id: 'research', enabled: true, isDefault: true }],
        getAgent: () => ({ enabled: true, model: '' }),
        createSession,
        getSession: () => created,
        updateSession: vi.fn(),
      }) as unknown as CoworkStore,
    getCoworkEngineRouter: () => ({ startSession }) as unknown as CoworkEngineRouter,
    waitForConfigUpdates: async () => {},
    getEngineNotReadyResponse: vi.fn(),
  });
  await expect(
    handlers.get('cowork:session:start')?.({}, { prompt: 'hello' }),
  ).resolves.toMatchObject({ success: true });
  expect(createSession.mock.calls[0][4]).toBe('main');
  expect(startSession).toHaveBeenCalledWith(
    created.id,
    'hello',
    expect.objectContaining({ agentId: 'main', workspaceRoot: createSession.mock.calls[0][1] }),
  );
});

test('rejects a direct conversation with a peer before preparing any runtime', async () => {
  const ensureEngineRunning = vi.fn();
  const getCoworkStore = vi.fn();
  registerCoworkSessionExecutionHandlers({
    ensureEngineRunning,
    getCoworkStore,
    getCoworkEngineRouter: vi.fn(),
    waitForConfigUpdates: vi.fn(),
    getEngineNotReadyResponse: vi.fn(),
  });
  await expect(
    handlers.get('cowork:session:start')?.({}, { prompt: 'hello', agentId: 'research' }),
  ).resolves.toMatchObject({ success: false, error: 'agentUnavailable' });
  expect(ensureEngineRunning).not.toHaveBeenCalled();
  expect(getCoworkStore).not.toHaveBeenCalled();
});
