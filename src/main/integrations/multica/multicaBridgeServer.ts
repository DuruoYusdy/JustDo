import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { StringDecoder } from 'string_decoder';

import { PRODUCT_NAME } from '../../../shared/productMetadata';
import {
  decodeMulticaBridgeLines,
  encodeMulticaBridgeMessage,
  getMulticaBridgeEndpoint,
  MULTICA_BRIDGE_HANDSHAKE_TIMEOUT_MS,
  MULTICA_BRIDGE_MAX_CONNECTIONS,
  MULTICA_BRIDGE_METADATA_FILE,
  MULTICA_BRIDGE_PROTOCOL_VERSION,
  MULTICA_MAX_REQUEST_BYTES,
  type MulticaBridgeMetadata,
  type MulticaBridgeRequest,
  type MulticaBridgeResponse,
  sanitizeMulticaBridgeEnvironment,
  validateMulticaCommandArgv,
} from './multicaBridgeProtocol';
import type { MulticaCommandService } from './multicaCommandService';

interface MulticaBridgeServerOptions {
  userDataPath: string;
  commandService: MulticaCommandService;
  handshakeTimeoutMs?: number;
  maxConnections?: number;
}

const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;

const isRequest = (value: unknown): value is MulticaBridgeRequest => {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<MulticaBridgeRequest>;
  return (
    request.type === 'request' &&
    typeof request.version === 'number' &&
    typeof request.requestId === 'string' &&
    typeof request.token === 'string' &&
    Array.isArray(request.argv) &&
    request.argv.every(argument => typeof argument === 'string') &&
    typeof request.cwd === 'string' &&
    Boolean(request.env) &&
    typeof request.env === 'object' &&
    !Array.isArray(request.env) &&
    Object.entries(request.env).every(
      ([name, value]) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && typeof value === 'string' && !value.includes('\0'),
    )
  );
};

export class MulticaBridgeServer {
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  private readonly abortControllers = new Set<AbortController>();
  private readonly executions = new Set<Promise<void>>();
  private readonly endpoint: string;
  private readonly token = crypto.randomBytes(32).toString('base64url');

  constructor(private readonly options: MulticaBridgeServerOptions) {
    this.endpoint = getMulticaBridgeEndpoint(options.userDataPath);
  }

  get running(): boolean {
    return this.server?.listening === true;
  }

  get activeTaskCount(): number {
    return this.options.commandService.activeTaskCount;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const directory = path.join(this.options.userDataPath, 'multica');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      const endpointDirectory = path.dirname(this.endpoint);
      fs.mkdirSync(endpointDirectory, { recursive: true, mode: 0o700 });
      fs.chmodSync(endpointDirectory, 0o700);
      fs.rmSync(this.endpoint, { force: true });
    }
    const server = net.createServer(socket => this.handleConnection(socket));
    const metadataPath = path.join(directory, MULTICA_BRIDGE_METADATA_FILE);
    const temporaryPath = `${metadataPath}.${process.pid}.tmp`;
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.endpoint, () => {
          server.off('error', reject);
          resolve();
        });
      });
      if (process.platform !== 'win32') fs.chmodSync(this.endpoint, 0o600);
      const metadata: MulticaBridgeMetadata = {
        version: MULTICA_BRIDGE_PROTOCOL_VERSION,
        endpoint: this.endpoint,
        token: this.token,
        pid: process.pid,
      };
      fs.writeFileSync(temporaryPath, JSON.stringify(metadata), { mode: 0o600 });
      fs.rmSync(metadataPath, { force: true });
      fs.renameSync(temporaryPath, metadataPath);
    } catch (error) {
      this.server = null;
      try {
        server.close();
      } catch {
        // The listen failure may already have closed the server.
      }
      fs.rmSync(temporaryPath, { force: true });
      fs.rmSync(metadataPath, { force: true });
      if (process.platform !== 'win32') fs.rmSync(this.endpoint, { force: true });
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    fs.rmSync(path.join(this.options.userDataPath, 'multica', MULTICA_BRIDGE_METADATA_FILE), {
      force: true,
    });
    if (!server) return;
    for (const controller of this.abortControllers) controller.abort();
    for (const socket of this.sockets) socket.destroy();
    const closeServer = new Promise<void>(resolve => server.close(() => resolve()));
    const drainExecutions = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS);
      void Promise.allSettled([...this.executions]).then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    await Promise.all([closeServer, drainExecutions]);
    if (process.platform !== 'win32') fs.rmSync(this.endpoint, { force: true });
  }

  private handleConnection(socket: net.Socket): void {
    if (this.sockets.size >= (this.options.maxConnections ?? MULTICA_BRIDGE_MAX_CONNECTIONS)) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    let buffer = '';
    let receivedBytes = 0;
    let handled = false;
    const decoder = new StringDecoder('utf8');
    const abortController = new AbortController();
    this.abortControllers.add(abortController);
    socket.setTimeout(
      this.options.handshakeTimeoutMs ?? MULTICA_BRIDGE_HANDSHAKE_TIMEOUT_MS,
      () => {
        socket.destroy();
      },
    );
    const send = (response: MulticaBridgeResponse): void => {
      if (!socket.destroyed) socket.write(encodeMulticaBridgeMessage(response));
    };
    socket.on('data', chunk => {
      if (handled) return;
      receivedBytes += chunk.length;
      if (receivedBytes > MULTICA_MAX_REQUEST_BYTES) {
        handled = true;
        send({ type: 'error', message: 'Multica bridge request is too large.' });
        socket.end();
        return;
      }
      buffer += decoder.write(chunk);
      let decoded: ReturnType<typeof decodeMulticaBridgeLines>;
      try {
        decoded = decodeMulticaBridgeLines(buffer);
      } catch {
        handled = true;
        send({ type: 'error', message: 'Invalid Multica bridge request.' });
        socket.end();
        return;
      }
      buffer = decoded.remainder;
      const raw = decoded.messages[0];
      if (!raw) return;
      handled = true;
      socket.setTimeout(0);
      const suppliedToken = isRequest(raw) ? Buffer.from(raw.token) : null;
      const expectedToken = Buffer.from(this.token);
      if (
        !isRequest(raw) ||
        raw.version !== MULTICA_BRIDGE_PROTOCOL_VERSION ||
        suppliedToken === null ||
        suppliedToken.length !== expectedToken.length ||
        !crypto.timingSafeEqual(suppliedToken, expectedToken)
      ) {
        send({ type: 'error', message: `Unauthorized ${PRODUCT_NAME} bridge request.` });
        socket.end();
        return;
      }
      const argv = validateMulticaCommandArgv(raw.argv);
      if (!argv) {
        send({ type: 'error', message: 'Unsupported Multica compatibility command.' });
        socket.end();
        return;
      }
      const execution = Promise.resolve()
        .then(() =>
          this.options.commandService.execute(
            argv,
            raw.cwd,
            sanitizeMulticaBridgeEnvironment(raw.env),
            abortController.signal,
          ),
        )
        .then(result => {
          if (result.stdout) {
            send({ type: 'stdout', data: Buffer.from(result.stdout).toString('base64') });
          }
          if (result.stderr) {
            send({ type: 'stderr', data: Buffer.from(result.stderr).toString('base64') });
          }
          send({ type: 'exit', code: result.exitCode });
          socket.end();
        })
        .catch(error => {
          send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
          socket.end();
        })
        .finally(() => {
          this.executions.delete(execution);
        });
      this.executions.add(execution);
    });
    socket.once('close', () => {
      this.sockets.delete(socket);
      this.abortControllers.delete(abortController);
      abortController.abort();
    });
    socket.once('error', () => abortController.abort());
  }
}
