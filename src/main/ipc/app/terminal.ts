import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import * as pty from 'node-pty';
import path from 'path';

import {
  type TerminalActionResult,
  type TerminalCreateRequest,
  type TerminalCreateResult,
  TerminalIpc,
  type TerminalResizeRequest,
  type TerminalWriteRequest,
} from '../../../shared/app/terminal';

const MAX_TERMINALS_PER_WINDOW = 16;
const MAX_WRITE_LENGTH = 64 * 1024;
const MIN_TERMINAL_COLUMNS = 2;
const MAX_TERMINAL_COLUMNS = 500;
const MIN_TERMINAL_ROWS = 1;
const MAX_TERMINAL_ROWS = 200;
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const POWERSHELL_UTF8_INIT =
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false; ' +
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; ' +
  '$global:OutputEncoding = [Console]::OutputEncoding';

interface ManagedTerminal {
  closing: boolean;
  ownerId: number;
  process: pty.IPty;
  gracefulExitTimer?: NodeJS.Timeout;
  forceKillTimer?: NodeJS.Timeout;
}

interface TerminalHandlerDependencies {
  buildEnvironment?: () => Promise<NodeJS.ProcessEnv>;
}

const terminals = new Map<string, ManagedTerminal>();
const pendingTerminalOwners = new Map<string, number>();
const ownerTerminalIds = new Map<number, Set<string>>();
const registeredOwners = new Set<number>();

const clampDimension = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Math.floor(value)));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isValidTerminalId = (value: unknown): value is string =>
  typeof value === 'string' && TERMINAL_ID_PATTERN.test(value);

const isTerminalCreateRequest = (value: unknown): value is TerminalCreateRequest =>
  isRecord(value) &&
  isValidTerminalId(value.id) &&
  typeof value.cwd === 'string' &&
  Number.isFinite(value.cols) &&
  Number.isFinite(value.rows);

const isTerminalWriteRequest = (value: unknown): value is TerminalWriteRequest =>
  isRecord(value) &&
  isValidTerminalId(value.id) &&
  typeof value.data === 'string' &&
  value.data.length <= MAX_WRITE_LENGTH;

const isTerminalResizeRequest = (value: unknown): value is TerminalResizeRequest =>
  isRecord(value) &&
  isValidTerminalId(value.id) &&
  Number.isFinite(value.cols) &&
  Number.isFinite(value.rows);

const resolveTerminalCwd = (cwd: string): string => {
  const resolved = path.resolve(cwd.trim());
  if (!cwd.trim() || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Terminal working directory does not exist');
  }
  return resolved;
};

const TERMINAL_COLOR_CONTROL_VARIABLES = new Set(['NO_COLOR', 'FORCE_COLOR']);

const getTerminalEnvironment = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !TERMINAL_COLOR_CONTROL_VARIABLES.has(entry[0].toUpperCase()),
    ),
  );

const findExecutableOnPath = (executable: string): string | undefined => {
  for (const directory of process.env.PATH?.split(path.delimiter) ?? []) {
    const normalizedDirectory = directory.replace(/^"|"$/g, '').trim();
    if (!path.isAbsolute(normalizedDirectory)) continue;
    const candidate = path.join(normalizedDirectory, executable);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
};

const getShell = (): { executable: string; args: string[] } => {
  if (process.platform === 'win32') {
    const bundledPowerShell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : undefined;
    return {
      executable:
        findExecutableOnPath('pwsh.exe') ||
        (bundledPowerShell && fs.existsSync(bundledPowerShell)
          ? bundledPowerShell
          : 'powershell.exe'),
      args: ['-NoLogo', '-NoExit', '-Command', POWERSHELL_UTF8_INIT],
    };
  }
  return { executable: process.env.SHELL || '/bin/bash', args: ['-l'] };
};

const forgetTerminal = (id: string): ManagedTerminal | undefined => {
  const managed = terminals.get(id);
  if (!managed) return undefined;
  terminals.delete(id);
  const ids = ownerTerminalIds.get(managed.ownerId);
  ids?.delete(id);
  if (ids?.size === 0) ownerTerminalIds.delete(managed.ownerId);
  return managed;
};

const forceKillTerminal = (managed: ManagedTerminal): void => {
  if (managed.gracefulExitTimer) {
    clearTimeout(managed.gracefulExitTimer);
    managed.gracefulExitTimer = undefined;
  }
  if (managed.forceKillTimer) {
    clearTimeout(managed.forceKillTimer);
    managed.forceKillTimer = undefined;
  }
  try {
    managed.process.kill();
  } catch {
    // The shell may already have exited.
  }
};

const terminateTerminal = (managed: ManagedTerminal): void => {
  managed.closing = true;
  if (process.platform !== 'win32') {
    forceKillTerminal(managed);
    return;
  }

  // node-pty's Windows force-kill path launches a short-lived ConPTY helper.
  // Let PowerShell/cmd exit normally first, avoiding an AttachConsole race when
  // the shell is idle. A fallback still guarantees cleanup for busy processes.
  try {
    managed.process.write('\x03');
    managed.gracefulExitTimer = setTimeout(() => {
      managed.gracefulExitTimer = undefined;
      try {
        managed.process.write('exit\r');
      } catch {
        forceKillTerminal(managed);
      }
    }, 75);
    managed.gracefulExitTimer.unref();
    managed.forceKillTimer = setTimeout(() => forceKillTerminal(managed), 1_500);
    managed.forceKillTimer.unref();
  } catch {
    forceKillTerminal(managed);
  }
};

const closeOwnedTerminals = (ownerId: number): void => {
  const ids = [...(ownerTerminalIds.get(ownerId) ?? [])];
  for (const id of ids) {
    const managed = forgetTerminal(id);
    if (managed) terminateTerminal(managed);
  }
  registeredOwners.delete(ownerId);
};

const countPendingTerminals = (ownerId: number): number =>
  [...pendingTerminalOwners.values()].filter(pendingOwnerId => pendingOwnerId === ownerId).length;

const findOwnedTerminal = (event: IpcMainInvokeEvent, id: string): ManagedTerminal | null => {
  const managed = terminals.get(id);
  return managed?.ownerId === event.sender.id ? managed : null;
};

export const registerTerminalHandlers = ({
  buildEnvironment = async () => process.env,
}: TerminalHandlerDependencies = {}): void => {
  ipcMain.handle(
    TerminalIpc.Create,
    async (event, request: unknown): Promise<TerminalCreateResult> => {
      try {
        if (
          !isTerminalCreateRequest(request) ||
          terminals.has(request.id) ||
          pendingTerminalOwners.has(request.id)
        ) {
          return { success: false, error: 'Invalid or duplicate terminal ID' };
        }
        const ownerId = event.sender.id;
        const ownedIds = ownerTerminalIds.get(ownerId) ?? new Set<string>();
        if (ownedIds.size + countPendingTerminals(ownerId) >= MAX_TERMINALS_PER_WINDOW) {
          return { success: false, error: 'Too many terminal tabs are open' };
        }
        const cwd = resolveTerminalCwd(request.cwd);
        const shell = getShell();
        pendingTerminalOwners.set(request.id, ownerId);
        let terminalProcess: pty.IPty;
        try {
          const environment = await buildEnvironment();
          if (event.sender.isDestroyed()) {
            return { success: false, error: 'Terminal owner was destroyed' };
          }
          terminalProcess = pty.spawn(shell.executable, shell.args, {
            name: 'xterm-256color',
            cols: clampDimension(request.cols, MIN_TERMINAL_COLUMNS, MAX_TERMINAL_COLUMNS),
            rows: clampDimension(request.rows, MIN_TERMINAL_ROWS, MAX_TERMINAL_ROWS),
            cwd,
            env: {
              ...getTerminalEnvironment(environment),
              COLORTERM: 'truecolor',
              TERM: 'xterm-256color',
              TERM_PROGRAM: 'xterm.js',
            },
          });
        } finally {
          pendingTerminalOwners.delete(request.id);
        }
        const managed: ManagedTerminal = { closing: false, ownerId, process: terminalProcess };
        terminals.set(request.id, managed);
        ownedIds.add(request.id);
        ownerTerminalIds.set(ownerId, ownedIds);

        if (!registeredOwners.has(ownerId)) {
          registeredOwners.add(ownerId);
          event.sender.once('destroyed', () => closeOwnedTerminals(ownerId));
        }

        terminalProcess.onData(data => {
          if (
            !managed.closing &&
            terminals.get(request.id) === managed &&
            !event.sender.isDestroyed()
          ) {
            event.sender.send(TerminalIpc.Data, { id: request.id, data });
          }
        });
        terminalProcess.onExit(({ exitCode }) => {
          if (managed.gracefulExitTimer) {
            clearTimeout(managed.gracefulExitTimer);
            managed.gracefulExitTimer = undefined;
          }
          if (managed.forceKillTimer) {
            clearTimeout(managed.forceKillTimer);
            managed.forceKillTimer = undefined;
          }
          const isCurrentInstance = terminals.get(request.id) === managed;
          if (isCurrentInstance) forgetTerminal(request.id);
          if (!managed.closing && isCurrentInstance && !event.sender.isDestroyed()) {
            event.sender.send(TerminalIpc.Exit, { id: request.id, exitCode });
          }
        });
        return { success: true, cwd };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create terminal',
        };
      }
    },
  );

  ipcMain.handle(TerminalIpc.Write, (event, request: unknown): TerminalActionResult => {
    if (!isTerminalWriteRequest(request)) {
      return { success: false, error: 'Invalid terminal write request' };
    }
    const managed = findOwnedTerminal(event, request.id);
    if (!managed || managed.closing) {
      return { success: false, error: 'Invalid terminal write request' };
    }
    try {
      managed.process.write(request.data);
      return { success: true };
    } catch {
      return { success: false, error: 'Terminal write failed' };
    }
  });

  ipcMain.handle(TerminalIpc.Resize, (event, request: unknown): TerminalActionResult => {
    if (!isTerminalResizeRequest(request)) {
      return { success: false, error: 'Invalid terminal resize request' };
    }
    const managed = findOwnedTerminal(event, request.id);
    if (!managed || managed.closing) {
      return { success: false, error: 'Invalid terminal resize request' };
    }
    try {
      managed.process.resize(
        clampDimension(request.cols, MIN_TERMINAL_COLUMNS, MAX_TERMINAL_COLUMNS),
        clampDimension(request.rows, MIN_TERMINAL_ROWS, MAX_TERMINAL_ROWS),
      );
      return { success: true };
    } catch {
      return { success: false, error: 'Terminal resize failed' };
    }
  });

  ipcMain.handle(TerminalIpc.Close, (event, id: unknown): TerminalActionResult => {
    if (!isValidTerminalId(id)) {
      return { success: false, error: 'Invalid terminal ID' };
    }
    const managed = findOwnedTerminal(event, id);
    if (!managed) return { success: false, error: 'Terminal was not found' };
    forgetTerminal(id);
    terminateTerminal(managed);
    return { success: true };
  });
};
