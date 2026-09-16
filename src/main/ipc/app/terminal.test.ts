import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let dataListener: ((data: string) => void) | undefined;
  let exitListener: ((event: { exitCode: number }) => void) | undefined;
  const terminalProcess = {
    kill: vi.fn(),
    onData: vi.fn((listener: (data: string) => void) => {
      dataListener = listener;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((listener: (event: { exitCode: number }) => void) => {
      exitListener = listener;
      return { dispose: vi.fn() };
    }),
    resize: vi.fn(),
    write: vi.fn(),
  };
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    },
    spawn: vi.fn(() => terminalProcess),
    terminalProcess,
    emitData: (data: string) => dataListener?.(data),
    emitExit: (exitCode: number) => exitListener?.({ exitCode }),
  };
});

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }));
vi.mock('node-pty', () => ({ spawn: mocks.spawn }));

import { TerminalIpc } from '../../../shared/terminal';
import { registerTerminalHandlers } from './terminal';

describe('terminal IPC', () => {
  const sender = {
    id: 7,
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    send: vi.fn(),
  };
  const event = { sender };
  const buildEnvironment = vi.fn(async () => ({
    PATH: process.env.PATH,
    OPENCLAW_STATE_DIR: 'C:\\state',
    JUSTDO_OPENCLAW_ENTRY: 'C:/runtime/gateway.asar/openclaw.mjs',
  }));

  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    sender.isDestroyed.mockReturnValue(false);
    registerTerminalHandlers({ buildEnvironment });
  });

  it('creates an owned PTY in the requested project directory and forwards data', async () => {
    const id = `terminal:test-${crypto.randomUUID()}`;
    const result = await mocks.handlers.get(TerminalIpc.Create)?.(event, {
      id,
      cwd: process.cwd(),
      cols: 100,
      rows: 30,
    });

    expect(result).toEqual({ success: true, cwd: process.cwd() });
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cwd: process.cwd(),
        cols: 100,
        rows: 30,
        env: expect.objectContaining({
          OPENCLAW_STATE_DIR: 'C:\\state',
          JUSTDO_OPENCLAW_ENTRY: 'C:/runtime/gateway.asar/openclaw.mjs',
        }),
      }),
    );
    expect(buildEnvironment).toHaveBeenCalledOnce();
    if (process.platform === 'win32') {
      expect(String(mocks.spawn.mock.calls[0]?.[0]).toLowerCase()).toContain('powershell');
      expect(mocks.spawn.mock.calls[0]?.[1]).toEqual([
        '-NoLogo',
        '-NoExit',
        '-Command',
        expect.stringContaining('UTF8Encoding'),
      ]);
    }

    mocks.emitData('ready');
    expect(sender.send).toHaveBeenCalledWith(TerminalIpc.Data, { id, data: 'ready' });

    expect(mocks.handlers.get(TerminalIpc.Write)?.(event, { id, data: 'pwd\r' })).toEqual({
      success: true,
    });
    expect(mocks.terminalProcess.write).toHaveBeenCalledWith('pwd\r');

    expect(mocks.handlers.get(TerminalIpc.Resize)?.(event, { id, cols: 120, rows: 40 })).toEqual({
      success: true,
    });
    expect(mocks.terminalProcess.resize).toHaveBeenCalledWith(120, 40);

    expect(mocks.handlers.get(TerminalIpc.Close)?.(event, id)).toEqual({ success: true });
    if (process.platform === 'win32') {
      expect(mocks.terminalProcess.write).toHaveBeenCalledWith('\x03');
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(mocks.terminalProcess.write).toHaveBeenCalledWith('exit\r');
      sender.send.mockClear();
      mocks.emitData('late output');
      expect(sender.send).not.toHaveBeenCalled();
      mocks.emitExit(0);
      expect(mocks.terminalProcess.kill).not.toHaveBeenCalled();
    } else {
      expect(mocks.terminalProcess.kill).toHaveBeenCalled();
    }
  });

  it('rejects missing directories and access from a different renderer', async () => {
    const missingId = `terminal:test-${crypto.randomUUID()}`;
    expect(
      await mocks.handlers.get(TerminalIpc.Create)?.(event, {
        id: missingId,
        cwd: `${process.cwd()}-missing`,
        cols: 80,
        rows: 24,
      }),
    ).toEqual(expect.objectContaining({ success: false }));
    expect(
      await mocks.handlers.get(TerminalIpc.Create)?.(event, {
        id: `terminal:test-${crypto.randomUUID()}`,
        cwd: process.cwd(),
        cols: Number.NaN,
        rows: 24,
      }),
    ).toEqual(expect.objectContaining({ success: false }));
    expect(mocks.handlers.get(TerminalIpc.Close)?.(event, { id: 'not-a-string' })).toEqual({
      success: false,
      error: 'Invalid terminal ID',
    });

    const id = `terminal:test-${crypto.randomUUID()}`;
    await mocks.handlers.get(TerminalIpc.Create)?.(event, {
      id,
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    });
    expect(
      mocks.handlers.get(TerminalIpc.Write)?.(
        { sender: { ...sender, id: 8 } },
        { id, data: 'dir\r' },
      ),
    ).toEqual({ success: false, error: 'Invalid terminal write request' });
    mocks.handlers.get(TerminalIpc.Close)?.(event, id);
    mocks.emitExit(0);
  });

  it('reserves a terminal ID while the OpenClaw environment is being prepared', async () => {
    let resolveEnvironment: ((env: NodeJS.ProcessEnv) => void) | undefined;
    registerTerminalHandlers({
      buildEnvironment: () =>
        new Promise(resolve => {
          resolveEnvironment = resolve;
        }),
    });
    const create = mocks.handlers.get(TerminalIpc.Create);
    const id = `terminal:test-${crypto.randomUUID()}`;
    const request = { id, cwd: process.cwd(), cols: 80, rows: 24 };

    const first = create?.(event, request) as Promise<unknown>;
    await Promise.resolve();
    await expect(create?.(event, request)).resolves.toEqual({
      success: false,
      error: 'Invalid or duplicate terminal ID',
    });

    resolveEnvironment?.({ PATH: process.env.PATH });
    await expect(first).resolves.toEqual({ success: true, cwd: process.cwd() });
    mocks.handlers.get(TerminalIpc.Close)?.(event, id);
    mocks.emitExit(0);
  });

  it('does not spawn a terminal after its renderer is destroyed', async () => {
    let resolveEnvironment: ((env: NodeJS.ProcessEnv) => void) | undefined;
    registerTerminalHandlers({
      buildEnvironment: () =>
        new Promise(resolve => {
          resolveEnvironment = resolve;
        }),
    });
    const create = mocks.handlers.get(TerminalIpc.Create);
    const pending = create?.(event, {
      id: `terminal:test-${crypto.randomUUID()}`,
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    });

    sender.isDestroyed.mockReturnValue(true);
    resolveEnvironment?.({ PATH: process.env.PATH });

    await expect(pending).resolves.toEqual({
      success: false,
      error: 'Terminal owner was destroyed',
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('counts pending terminal creation against the per-window limit', async () => {
    const environmentResolvers: Array<(env: NodeJS.ProcessEnv) => void> = [];
    registerTerminalHandlers({
      buildEnvironment: () =>
        new Promise(resolve => {
          environmentResolvers.push(resolve);
        }),
    });
    const create = mocks.handlers.get(TerminalIpc.Create);
    const ids = Array.from({ length: 16 }, () => `terminal:test-${crypto.randomUUID()}`);
    const pending = ids.map(id => create?.(event, { id, cwd: process.cwd(), cols: 80, rows: 24 }));

    await expect(
      create?.(event, {
        id: `terminal:test-${crypto.randomUUID()}`,
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ success: false, error: 'Too many terminal tabs are open' });

    for (const resolve of environmentResolvers) resolve({ PATH: process.env.PATH });
    const results = await Promise.all(pending);
    expect(results).toHaveLength(16);
    expect(results.every(result => result?.success === true)).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledTimes(16);
    for (const id of ids) mocks.handlers.get(TerminalIpc.Close)?.(event, id);
  });

  it('returns an error without spawning when OpenClaw preparation fails', async () => {
    registerTerminalHandlers({
      buildEnvironment: vi.fn().mockRejectedValue(new Error('runtime unavailable')),
    });
    const id = `terminal:test-${crypto.randomUUID()}`;
    const result = await mocks.handlers.get(TerminalIpc.Create)?.(event, {
      id,
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    });

    expect(result).toEqual({ success: false, error: 'runtime unavailable' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
