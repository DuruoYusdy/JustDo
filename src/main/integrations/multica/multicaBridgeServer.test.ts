import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decodeMulticaBridgeLines,
  encodeMulticaBridgeMessage,
  MULTICA_BRIDGE_METADATA_FILE,
  MULTICA_BRIDGE_PROTOCOL_VERSION,
  type MulticaBridgeMetadata,
  type MulticaBridgeResponse,
} from './multicaBridgeProtocol';
import { MulticaBridgeServer } from './multicaBridgeServer';
import type { MulticaCommandService } from './multicaCommandService';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('MulticaBridgeServer', () => {
  it('closes unauthenticated connections after the handshake deadline', async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-bridge-'));
    temporaryDirectories.push(userDataPath);
    const server = new MulticaBridgeServer({
      userDataPath,
      commandService: { activeTaskCount: 0, execute: vi.fn() } as unknown as MulticaCommandService,
      handshakeTimeoutMs: 25,
    });
    await server.start();
    try {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(userDataPath, 'multica', MULTICA_BRIDGE_METADATA_FILE), 'utf8'),
      ) as MulticaBridgeMetadata;
      const socket = net.createConnection(metadata.endpoint);
      socket.resume();
      await new Promise<void>((resolve, reject) => {
        socket.once('error', error => {
          if (!socket.destroyed) reject(error);
        });
        socket.once('close', () => resolve());
      });
      expect(socket.destroyed).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('decodes a request split inside a multibyte UTF-8 prompt', async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-bridge-'));
    temporaryDirectories.push(userDataPath);
    const execute = vi.fn().mockResolvedValue({ exitCode: 0 });
    const server = new MulticaBridgeServer({
      userDataPath,
      commandService: { activeTaskCount: 0, execute } as unknown as MulticaCommandService,
    });
    await server.start();
    try {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(userDataPath, 'multica', MULTICA_BRIDGE_METADATA_FILE), 'utf8'),
      ) as MulticaBridgeMetadata;
      const frame = Buffer.from(
        encodeMulticaBridgeMessage({
          type: 'request',
          version: MULTICA_BRIDGE_PROTOCOL_VERSION,
          requestId: 'request-split-utf8',
          token: metadata.token,
          argv: ['agent', '--json', '--session-id', 'one', '--message', '中文任务'],
          cwd: userDataPath,
          env: { MULTICA_TASK_ID: '任务一', NODE_OPTIONS: '--inspect' },
        }),
      );
      const splitAt = frame.indexOf(Buffer.from('中')) + 1;
      const socket = net.createConnection(metadata.endpoint);
      socket.resume();
      await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.write(frame.subarray(0, splitAt));
          socket.write(frame.subarray(splitAt));
        });
        socket.once('close', () => resolve());
      });

      expect(execute).toHaveBeenCalledWith(
        ['agent', '--json', '--session-id', 'one', '--message', '中文任务'],
        userDataPath,
        { MULTICA_TASK_ID: '任务一' },
        expect.any(AbortSignal),
      );
    } finally {
      await server.stop();
    }
  });

  it('authenticates and relays one command over the local transport', async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-bridge-'));
    temporaryDirectories.push(userDataPath);
    const execute = vi.fn().mockResolvedValue({
      stdout: 'openclaw v2026.9.2\n',
      exitCode: 0,
    });
    const commandService = {
      activeTaskCount: 0,
      execute,
    } as unknown as MulticaCommandService;
    const server = new MulticaBridgeServer({ userDataPath, commandService });
    await server.start();

    try {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(userDataPath, 'multica', MULTICA_BRIDGE_METADATA_FILE), 'utf8'),
      ) as MulticaBridgeMetadata;
      const responses = await new Promise<MulticaBridgeResponse[]>((resolve, reject) => {
        const socket = net.createConnection(metadata.endpoint);
        let buffer = '';
        const received: MulticaBridgeResponse[] = [];
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.write(
            encodeMulticaBridgeMessage({
              type: 'request',
              version: MULTICA_BRIDGE_PROTOCOL_VERSION,
              requestId: 'request-1',
              token: metadata.token,
              argv: ['--version'],
              cwd: userDataPath,
              env: {},
            }),
          );
        });
        socket.on('data', chunk => {
          buffer += chunk.toString('utf8');
          const decoded = decodeMulticaBridgeLines(buffer);
          buffer = decoded.remainder;
          received.push(...(decoded.messages as MulticaBridgeResponse[]));
        });
        socket.once('close', () => resolve(received));
      });

      expect(execute).toHaveBeenCalledWith(
        ['--version'],
        userDataPath,
        {},
        expect.any(AbortSignal),
      );
      expect(responses).toEqual([
        { type: 'stdout', data: Buffer.from('openclaw v2026.9.2\n').toString('base64') },
        { type: 'exit', code: 0 },
      ]);
    } finally {
      await server.stop();
    }
  });

  it('rejects command arguments that bypass the compatibility allowlist', async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-bridge-'));
    temporaryDirectories.push(userDataPath);
    const execute = vi.fn();
    const commandService = {
      activeTaskCount: 0,
      execute,
    } as unknown as MulticaCommandService;
    const server = new MulticaBridgeServer({ userDataPath, commandService });
    await server.start();

    try {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(userDataPath, 'multica', MULTICA_BRIDGE_METADATA_FILE), 'utf8'),
      ) as MulticaBridgeMetadata;
      const responses = await new Promise<MulticaBridgeResponse[]>((resolve, reject) => {
        const socket = net.createConnection(metadata.endpoint);
        let buffer = '';
        const received: MulticaBridgeResponse[] = [];
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.write(
            encodeMulticaBridgeMessage({
              type: 'request',
              version: MULTICA_BRIDGE_PROTOCOL_VERSION,
              requestId: 'request-2',
              token: metadata.token,
              argv: ['agent', '--json', '--session-id', 'one', '--message', 'task', '--unknown'],
              cwd: userDataPath,
              env: {},
            }),
          );
        });
        socket.on('data', chunk => {
          buffer += chunk.toString('utf8');
          const decoded = decodeMulticaBridgeLines(buffer);
          buffer = decoded.remainder;
          received.push(...(decoded.messages as MulticaBridgeResponse[]));
        });
        socket.once('close', () => resolve(received));
      });

      expect(execute).not.toHaveBeenCalled();
      expect(responses).toEqual([
        { type: 'error', message: 'Unsupported Multica compatibility command.' },
      ]);
    } finally {
      await server.stop();
    }
  });

  it('rejects a same-character-length Unicode token without throwing', async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-bridge-'));
    temporaryDirectories.push(userDataPath);
    const execute = vi.fn();
    const server = new MulticaBridgeServer({
      userDataPath,
      commandService: { activeTaskCount: 0, execute } as unknown as MulticaCommandService,
    });
    await server.start();

    try {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(userDataPath, 'multica', MULTICA_BRIDGE_METADATA_FILE), 'utf8'),
      ) as MulticaBridgeMetadata;
      const responses = await new Promise<MulticaBridgeResponse[]>((resolve, reject) => {
        const socket = net.createConnection(metadata.endpoint);
        let buffer = '';
        const received: MulticaBridgeResponse[] = [];
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.write(
            encodeMulticaBridgeMessage({
              type: 'request',
              version: MULTICA_BRIDGE_PROTOCOL_VERSION,
              requestId: 'request-unicode-token',
              token: 'é'.repeat(metadata.token.length),
              argv: ['--version'],
              cwd: userDataPath,
              env: {},
            }),
          );
        });
        socket.on('data', chunk => {
          buffer += chunk.toString('utf8');
          const decoded = decodeMulticaBridgeLines(buffer);
          buffer = decoded.remainder;
          received.push(...(decoded.messages as MulticaBridgeResponse[]));
        });
        socket.once('close', () => resolve(received));
      });

      expect(execute).not.toHaveBeenCalled();
      expect(responses[0]).toMatchObject({ type: 'error' });
    } finally {
      await server.stop();
    }
  });

  it('aborts active commands before waiting for the transport to close', async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-bridge-'));
    temporaryDirectories.push(userDataPath);
    let receivedSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const execute = vi.fn(
      (_argv: string[], _cwd: string, _env: Record<string, string>, signal: AbortSignal) =>
        new Promise<{ stderr: string; exitCode: number }>(resolve => {
          receivedSignal = signal;
          markStarted?.();
          signal.addEventListener(
            'abort',
            () => resolve({ stderr: 'cancelled\n', exitCode: 130 }),
            { once: true },
          );
        }),
    );
    const server = new MulticaBridgeServer({
      userDataPath,
      commandService: { activeTaskCount: 1, execute } as unknown as MulticaCommandService,
    });
    await server.start();
    const metadata = JSON.parse(
      fs.readFileSync(path.join(userDataPath, 'multica', MULTICA_BRIDGE_METADATA_FILE), 'utf8'),
    ) as MulticaBridgeMetadata;
    const socket = net.createConnection(metadata.endpoint);
    const closed = new Promise<void>(resolve => socket.once('close', resolve));
    socket.once('connect', () => {
      socket.write(
        encodeMulticaBridgeMessage({
          type: 'request',
          version: MULTICA_BRIDGE_PROTOCOL_VERSION,
          requestId: 'request-shutdown',
          token: metadata.token,
          argv: ['agent', '--json', '--session-id', 'one', '--message', 'task'],
          cwd: userDataPath,
          env: {},
        }),
      );
    });

    await started;
    await server.stop();
    await closed;

    expect(receivedSignal?.aborted).toBe(true);
    await expect(execute.mock.results[0].value).resolves.toEqual({
      stderr: 'cancelled\n',
      exitCode: 130,
    });
    expect(socket.destroyed).toBe(true);
  });
});
