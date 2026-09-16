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

  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    registerTerminalHandlers();
  });

  it('creates an owned PTY in the requested project directory and forwards data', async () => {
    const id = `terminal:test-${crypto.randomUUID()}`;
    const result = mocks.handlers.get(TerminalIpc.Create)?.(event, {
      id,
      cwd: process.cwd(),
      cols: 100,
      rows: 30,
    });

    expect(result).toEqual({ success: true, cwd: process.cwd() });
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: process.cwd(), cols: 100, rows: 30 }),
    );
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

  it('rejects missing directories and access from a different renderer', () => {
    const missingId = `terminal:test-${crypto.randomUUID()}`;
    expect(
      mocks.handlers.get(TerminalIpc.Create)?.(event, {
        id: missingId,
        cwd: `${process.cwd()}-missing`,
        cols: 80,
        rows: 24,
      }),
    ).toEqual(expect.objectContaining({ success: false }));
    expect(
      mocks.handlers.get(TerminalIpc.Create)?.(event, {
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
    mocks.handlers.get(TerminalIpc.Create)?.(event, {
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
});
