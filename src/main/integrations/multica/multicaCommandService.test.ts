import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoworkStore } from '../../data/coworkStore';
import { MulticaCommandService } from './multicaCommandService';
import type {
  MulticaExternalSession,
  MulticaExternalSessionStore,
} from './multicaExternalSessionStore';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const fixture = (existingExternal?: MulticaExternalSession) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-'));
  temporaryDirectories.push(cwd);
  const configPath = path.join(cwd, 'openclaw-config.json');
  fs.writeFileSync(configPath, '{}');
  const session = {
    id: 'cowork-1',
    agentId: 'main',
    cwd,
    status: 'idle',
  };
  let external = existingExternal ?? null;
  const coworkStore = {
    listAgents: vi.fn(() => [
      { id: 'main', name: 'Main Agent', model: 'provider/model', enabled: true },
      { id: 'disabled', name: 'Disabled', model: '', enabled: false },
      { id: 'justdo-scheduler', name: 'Scheduler', model: '', enabled: true },
    ]),
    getAgent: vi.fn((id: string) =>
      id === 'main'
        ? { id: 'main', name: 'Main Agent', model: 'provider/model', enabled: true }
        : null,
    ),
    getConfig: vi.fn(() => ({ permissionMode: 'full' })),
    createSession: vi.fn(() => session),
    deleteSession: vi.fn(),
    getSession: vi.fn(() => session),
    updateSession: vi.fn(),
    beginSessionRun: vi.fn(input => ({
      id: 'run-timing-1',
      ...input,
      rootRunId: 'root-run-1',
      state: 'running',
    })),
    getSessionRun: vi.fn(() => ({
      id: 'run-timing-1',
      sessionId: session.id,
      clientTurnId: 'client-turn-1',
      rootRunId: 'root-run-1',
      startedAt: 1,
      state: 'running',
    })),
    finishSessionRun: vi.fn(),
  } as unknown as CoworkStore;
  const externalStore = {
    get: vi.fn(() => external),
    wasDeleted: vi.fn(() => false),
    create: vi.fn(input => {
      external = {
        ...input,
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
      } as MulticaExternalSession;
      return external;
    }),
    setStatus: vi.fn(),
  } as unknown as MulticaExternalSessionStore;
  const runOpenClaw = vi.fn().mockResolvedValue({
    stdout: `${JSON.stringify({
      runId: 'run-1',
      status: 'ok',
      summary: 'completed',
      result: {
        payloads: [{ text: 'Finished from JustDo', mediaUrl: null }],
        meta: {
          agentMeta: {
            sessionId: 'multica-1',
            provider: 'provider',
            model: 'model',
            usage: { input: 12, output: 4 },
          },
        },
      },
    })}\n`,
    exitCode: 0,
  });
  const service = new MulticaCommandService({
    getCoworkStore: () => coworkStore,
    getExternalSessionStore: () => externalStore,
    getConfigPath: () => path.join(cwd, 'openclaw.json'),
    getOpenClawVersion: () => 'v2026.9.2',
    runOpenClaw,
    waitForConfigUpdates: vi.fn().mockResolvedValue(undefined),
    isEnabled: () => true,
    onSessionsChanged: vi.fn(),
  });
  const taskEnv = {
    MULTICA_TOKEN: 'mat_test',
    MULTICA_TASK_CONFIG_ROOT: cwd,
    MULTICA_WORKSPACES_ROOT: cwd,
    MULTICA_SERVER_URL: 'http://127.0.0.1:3131',
    MULTICA_WORKSPACE_ID: 'workspace-1',
    MULTICA_AGENT_ID: 'agent-1',
    MULTICA_TASK_ID: 'task-1',
    OPENCLAW_CONFIG_PATH: configPath,
  };
  return { cwd, coworkStore, externalStore, runOpenClaw, service, taskEnv };
};

describe('MulticaCommandService', () => {
  it('reports the current registry agents without exposing the scheduler', async () => {
    const { cwd, service } = fixture();
    const result = await service.execute(['agents', 'list', '--json'], cwd);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout ?? '')).toEqual([
      { id: 'main', name: 'Main Agent', model: 'provider/model' },
    ]);
  });

  it('runs the task through the existing Gateway and returns only the visible reply', async () => {
    const { cwd, coworkStore, externalStore, runOpenClaw, service, taskEnv } = fixture();
    const result = await service.execute(
      [
        'agent',
        '--local',
        '--json',
        '--session-id',
        'multica-1',
        '--agent',
        'main',
        '--message',
        'task',
      ],
      cwd,
      taskEnv,
    );
    expect(result.exitCode).toBe(0);
    expect(coworkStore.createSession).toHaveBeenCalledWith(
      'task',
      cwd,
      'local',
      [],
      'main',
      'full',
      'provider/model',
    );
    expect(runOpenClaw).toHaveBeenCalledWith(
      expect.arrayContaining(['--session-key', expect.stringMatching(/^agent:main:multica:/)]),
      cwd,
      taskEnv,
      undefined,
    );
    expect(runOpenClaw.mock.calls[0]?.[0]).not.toContain('--local');
    expect(externalStore.setStatus).toHaveBeenLastCalledWith('multica-1', 'completed');
    expect(result.stdout).toBe('Finished from JustDo\n');
  });

  it('uses the Multica user message instead of its runtime preamble as the session title', async () => {
    const { cwd, coworkStore, service, taskEnv } = fixture();
    const prompt = [
      '# Multica Agent Runtime',
      '',
      'Runtime instructions.',
      '',
      'User message:',
      '你好啊',
      '',
      '## Task Initiator',
      '',
      'Member details.',
    ].join('\n');

    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-title', '--message', prompt],
      cwd,
      taskEnv,
    );

    expect(result.exitCode).toBe(0);
    expect(coworkStore.createSession).toHaveBeenCalledWith(
      '你好啊',
      cwd,
      'local',
      [],
      'main',
      'full',
      'provider/model',
    );
  });

  it('rejects a resumed session that changes its worktree', async () => {
    const original = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-original-'));
    temporaryDirectories.push(original);
    const { cwd, runOpenClaw, service, taskEnv } = fixture({
      externalSessionKey: 'multica-1',
      coworkSessionId: 'cowork-1',
      agentId: 'main',
      openclawSessionKey: 'agent:main:multica:existing',
      cwd: original,
      status: 'completed',
      createdAt: 1,
      updatedAt: 1,
    });
    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-1', '--message', 'next'],
      cwd,
      taskEnv,
    );
    expect(result).toMatchObject({ exitCode: 64 });
    expect(runOpenClaw).not.toHaveBeenCalled();
  });

  it('restores a newly linked Cowork session when the request is already cancelled', async () => {
    const { cwd, coworkStore, externalStore, runOpenClaw, service, taskEnv } = fixture();
    const controller = new AbortController();
    controller.abort();

    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-1', '--message', 'task'],
      cwd,
      taskEnv,
      controller.signal,
    );

    expect(result.exitCode).toBe(130);
    expect(runOpenClaw).not.toHaveBeenCalled();
    expect(externalStore.setStatus).toHaveBeenLastCalledWith('multica-1', 'cancelled');
    expect(coworkStore.updateSession).toHaveBeenLastCalledWith('cowork-1', { status: 'idle' });
  });

  it('reserves an external session before asynchronous runtime preparation', async () => {
    const { cwd, coworkStore, service, taskEnv } = fixture();
    const first = service.execute(
      ['agent', '--json', '--session-id', 'multica-1', '--message', 'first'],
      cwd,
      taskEnv,
    );
    const second = await service.execute(
      ['agent', '--json', '--session-id', 'multica-1', '--message', 'second'],
      cwd,
      taskEnv,
    );

    expect(second).toEqual({
      stdout: '{"type":"error","message":"This Multica session already has an active task."}\n',
      stderr: 'This Multica session already has an active task.\n',
      exitCode: 75,
    });
    expect((await first).exitCode).toBe(0);
    expect(coworkStore.createSession).toHaveBeenCalledTimes(1);
  });

  it('removes an orphan Cowork session if the external mapping cannot be persisted', async () => {
    const { cwd, coworkStore, externalStore, service, taskEnv } = fixture();
    vi.mocked(externalStore.create).mockImplementationOnce(() => {
      throw new Error('mapping failed');
    });

    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-1', '--message', 'task'],
      cwd,
      taskEnv,
    );

    expect(result).toMatchObject({ exitCode: 1, stderr: 'mapping failed\n' });
    expect(result.stdout).toContain('"type":"error"');
    expect(coworkStore.deleteSession).toHaveBeenCalledWith('cowork-1');
    expect(service.activeTaskCount).toBe(0);
  });

  it('does not silently recreate a deleted external session', async () => {
    const { cwd, coworkStore, externalStore, service, taskEnv } = fixture();
    vi.mocked(externalStore.wasDeleted).mockReturnValueOnce(true);

    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-deleted', '--message', 'resume'],
      cwd,
      taskEnv,
    );

    expect(result.exitCode).toBe(66);
    expect(coworkStore.createSession).not.toHaveBeenCalled();
  });

  it('reports an OpenClaw process failure instead of completing the Multica task', async () => {
    const { cwd, externalStore, runOpenClaw, service, taskEnv } = fixture();
    runOpenClaw.mockResolvedValueOnce({ stderr: 'provider failed\n', exitCode: 1 });

    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-error', '--message', 'task'],
      cwd,
      taskEnv,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('provider failed');
    expect(result.stdout).toContain('provider failed');
    expect(externalStore.setStatus).toHaveBeenLastCalledWith('multica-error', 'error');
  });

  it('fails closed when Multica omits its task-scoped identity', async () => {
    const { cwd, runOpenClaw, service, taskEnv } = fixture();
    const { MULTICA_TOKEN: _token, ...missingToken } = taskEnv;

    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-auth', '--message', 'task'],
      cwd,
      missingToken,
    );

    expect(result.exitCode).toBe(78);
    expect(result.stderr).toContain('task-scoped auth');
    expect(runOpenClaw).not.toHaveBeenCalled();
  });

  it('accepts Multica tasks without the optional workspaces root', async () => {
    const { cwd, runOpenClaw, service, taskEnv } = fixture();
    const { MULTICA_WORKSPACES_ROOT: _workspacesRoot, ...currentTaskEnv } = taskEnv;

    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-current', '--message', 'task'],
      cwd,
      currentTaskEnv,
    );

    expect(result.exitCode).toBe(0);
    expect(runOpenClaw).toHaveBeenCalledWith(expect.any(Array), cwd, currentTaskEnv, undefined);
  });

  it('accepts a successful task whose OpenClaw payload contains no text', async () => {
    const { cwd, runOpenClaw, service, taskEnv } = fixture();
    runOpenClaw.mockResolvedValueOnce({
      stdout:
        '{"runId":"run-empty","status":"ok","summary":"completed","result":{"payloads":[],"meta":{"durationMs":1}}}\n',
      exitCode: 0,
    });

    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-empty', '--message', 'task'],
      cwd,
      taskEnv,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeUndefined();
  });

  it('returns every visible reply and attachment without exposing execution metadata', async () => {
    const { cwd, runOpenClaw, service, taskEnv } = fixture();
    runOpenClaw.mockResolvedValueOnce({
      stdout: `${JSON.stringify({
        runId: 'run-rich',
        status: 'ok',
        summary: 'completed',
        result: {
          payloads: [
            { text: 'First reply', mediaUrl: 'file:///report.pdf' },
            { text: 'Second reply', mediaUrls: ['https://example.com/image.png'] },
          ],
          meta: { durationMs: 1 },
        },
      })}\n`,
      exitCode: 0,
    });

    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-rich', '--message', 'task'],
      cwd,
      taskEnv,
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stdout:
        'First reply\nAttachment: file:///report.pdf\nSecond reply\nAttachment: https://example.com/image.png\n',
    });
    expect(result.stdout).not.toContain('durationMs');
  });

  it('fails the task when a successful process returns an invalid Agent envelope', async () => {
    const { cwd, coworkStore, externalStore, runOpenClaw, service, taskEnv } = fixture();
    runOpenClaw.mockResolvedValueOnce({ stdout: 'not json\n', exitCode: 0 });

    const result = await service.execute(
      ['agent', '--json', '--session-id', 'multica-invalid', '--message', 'task'],
      cwd,
      taskEnv,
    );

    expect(result).toMatchObject({
      exitCode: 1,
      stderr: 'The Agent returned an invalid response.\n',
    });
    expect(externalStore.setStatus).toHaveBeenLastCalledWith('multica-invalid', 'error');
    expect(coworkStore.updateSession).toHaveBeenLastCalledWith('cowork-1', { status: 'error' });
  });
});
