import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import {
  BROWSER_EXTENSION_ID,
  type BrowserExtensionChatApi,
  BrowserExtensionChatServer,
} from './browserExtensionChatServer';

const token = 'a'.repeat(64);
let server: BrowserExtensionChatServer | null = null;

const createApi = (): BrowserExtensionChatApi => ({
  listSessions: vi.fn(() => [
    {
      createdAt: 1_000,
      cwd: 'C:\\workspace',
      id: 'one',
      permissionMode: 'full',
      status: 'idle',
      title: 'One',
      updatedAt: 2_000,
    },
  ]),
  getMessages: vi.fn(async () => [{ role: 'assistant', text: 'Hello' }]),
  getComposerOptions: vi.fn(async () => ({
    modelRef: 'provider/model',
    models: [{ id: 'provider/model', name: 'Model' }],
    permissionMode: 'full',
  })),
  startThread: vi.fn(async title => ({
    id: 'new',
    createdAt: 1_000,
    cwd: 'C:\\workspace',
    permissionMode: 'full',
    status: 'idle',
    title: title ?? 'New',
    updatedAt: 2,
  })),
  sendMessage: vi.fn(async () => ({ sessionId: 'one', runId: 'run-1' })),
  getThreadRuntimeStatus: vi.fn(async () => ({ known: true, running: false })),
  consumeTurnError: vi.fn(() => undefined),
  interruptThread: vi.fn(async () => undefined),
});

const connect = async (url: string, origin = `chrome-extension://${BROWSER_EXTENSION_ID}`) => {
  const socket = new WebSocket(url, { origin });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
};

const request = async (socket: WebSocket, id: string, method: string, params = {}) => {
  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out.')), 2_000);
    const onMessage = (data: WebSocket.RawData) => {
      const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
      if (parsed.id !== id) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(parsed);
    };
    socket.on('message', onMessage);
  });
  socket.send(JSON.stringify({ id, method, params }));
  return response;
};

afterEach(async () => {
  await server?.stop();
  server = null;
});

describe('BrowserExtensionChatServer', () => {
  it('requires the fixed extension origin and capability URL', async () => {
    server = new BrowserExtensionChatServer(createApi(), token, '1.0.0');
    await server.start();
    const capability = server.getCapability();

    await expect(
      connect(capability.localAppServerUrl, 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).rejects.toThrow();
    await expect(
      connect(capability.localAppServerUrl.replace(token, 'b'.repeat(64))),
    ).rejects.toThrow();
  });

  it('uses the Codex app-server request and notification shape', async () => {
    const api = createApi();
    server = new BrowserExtensionChatServer(api, token, '1.0.0');
    await server.start();
    const socket = await connect(server.getCapability().localAppServerUrl);

    await expect(request(socket, '1', 'initialize')).resolves.toMatchObject({
      id: '1',
      result: { platformFamily: expect.any(String), userAgent: 'JustDo/1.0.0' },
    });
    socket.send(JSON.stringify({ method: 'initialized' }));
    await expect(request(socket, '2', 'thread/list')).resolves.toMatchObject({
      result: { data: [{ id: 'one', status: { type: 'idle' } }], nextCursor: null },
    });
    await expect(
      request(socket, '3', 'thread/read', { includeTurns: true, threadId: 'one' }),
    ).resolves.toMatchObject({
      result: {
        thread: {
          id: 'one',
          turns: [{ items: [{ text: 'Hello', type: 'agentMessage' }], status: 'completed' }],
        },
      },
    });
    await expect(
      request(socket, 'options', 'composer/options', { threadId: 'one' }),
    ).resolves.toMatchObject({
      result: {
        modelRef: 'provider/model',
        models: [{ id: 'provider/model', name: 'Model' }],
        permissionMode: 'full',
      },
    });
    await expect(
      request(socket, '4', 'turn/start', {
        attachments: [{ base64Data: 'aGVsbG8=', mimeType: 'text/plain', name: 'note.txt' }],
        input: [{ text: 'Question', type: 'text' }],
        modelRef: 'provider/model',
        permissionMode: 'auto',
        threadId: 'one',
      }),
    ).resolves.toMatchObject({
      result: { turn: { error: null, id: 'run-1', items: [], status: 'inProgress' } },
    });
    expect(api.sendMessage).toHaveBeenCalledWith({
      attachments: [{ base64Data: 'aGVsbG8=', mimeType: 'text/plain', name: 'note.txt' }],
      message: 'Question',
      modelRef: 'provider/model',
      pageContext: undefined,
      permissionMode: 'auto',
      sessionId: 'one',
    });
    await expect(
      request(socket, '5', 'turn/start', {
        input: [{ text: 'Question', type: 'text' }],
        permissionMode: 'unexpected',
        threadId: 'one',
      }),
    ).resolves.toMatchObject({ error: { message: 'Invalid permission mode.' } });
    socket.close();
  });

  it('restores a thread notification subscription when the client reads it', async () => {
    const api = createApi();
    server = new BrowserExtensionChatServer(api, token, '1.0.0');
    await server.start();
    const url = server.getCapability().localAppServerUrl;
    const reader = await connect(url);
    const sender = await connect(url);
    await request(reader, 'reader-init', 'initialize');
    reader.send(JSON.stringify({ method: 'initialized' }));
    await request(sender, 'sender-init', 'initialize');
    sender.send(JSON.stringify({ method: 'initialized' }));
    await request(reader, 'read', 'thread/read', { includeTurns: true, threadId: 'one' });

    const notification = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for notification.')),
        2_000,
      );
      const onMessage = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.method !== 'turn/started') return;
        clearTimeout(timeout);
        reader.off('message', onMessage);
        resolve(message);
      };
      reader.on('message', onMessage);
    });

    await request(sender, 'turn', 'turn/start', {
      input: [{ text: 'Question', type: 'text' }],
      threadId: 'one',
    });
    await expect(notification).resolves.toMatchObject({
      method: 'turn/started',
      params: { threadId: 'one' },
    });
    reader.close();
    sender.close();
  });

  it('keeps active turn reconciliation running across an app-server restart', async () => {
    const api = createApi();
    let historyReads = 0;
    vi.mocked(api.getMessages).mockImplementation(async () => {
      historyReads += 1;
      return historyReads === 1
        ? [{ role: 'assistant', text: 'Earlier answer' }]
        : [
            { role: 'user', text: 'Question' },
            { role: 'assistant', text: 'Final answer' },
          ];
    });
    server = new BrowserExtensionChatServer(api, token, '1.0.0');
    await server.start();
    const original = await connect(server.getCapability().localAppServerUrl);
    await request(original, 'init', 'initialize');
    original.send(JSON.stringify({ method: 'initialized' }));
    await request(original, 'turn', 'turn/start', {
      input: [{ text: 'Question', type: 'text' }],
      threadId: 'one',
    });

    await server.restart();
    const reconnected = await connect(server.getCapability().localAppServerUrl);
    await request(reconnected, 'reinit', 'initialize');
    reconnected.send(JSON.stringify({ method: 'initialized' }));
    const completion = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for completion.')),
        3_000,
      );
      const onMessage = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.method !== 'turn/completed') return;
        clearTimeout(timeout);
        reconnected.off('message', onMessage);
        resolve(message);
      };
      reconnected.on('message', onMessage);
    });
    await request(reconnected, 'read', 'thread/read', { includeTurns: true, threadId: 'one' });

    await expect(completion).resolves.toMatchObject({
      method: 'turn/completed',
      params: { threadId: 'one' },
    });
    reconnected.close();
  });

  it('keeps polling briefly when final history lags behind terminal status', async () => {
    const api = createApi();
    let historyReads = 0;
    vi.mocked(api.getMessages).mockImplementation(async () => {
      historyReads += 1;
      return historyReads < 6
        ? [
            { role: 'user', text: 'Question' },
            ...(historyReads > 1
              ? [{ role: 'assistant', text: '', thinking: 'Still working.' }]
              : []),
          ]
        : [
            { role: 'user', text: 'Question' },
            { role: 'assistant', text: 'Delayed answer' },
          ];
    });
    server = new BrowserExtensionChatServer(api, token, '1.0.0');
    await server.start();
    const socket = await connect(server.getCapability().localAppServerUrl);

    await request(socket, '1', 'initialize');
    socket.send(JSON.stringify({ method: 'initialized' }));
    const finalHistory = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for final history.')),
        5_000,
      );
      const onMessage = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString()) as {
          method?: string;
          params?: { thread?: { turns?: Array<{ items?: Array<{ text?: string }> }> } };
        };
        const hasAnswer = message.params?.thread?.turns?.some(turn =>
          turn.items?.some(item => item.text === 'Delayed answer'),
        );
        if (message.method !== 'thread/updated' || !hasAnswer) return;
        clearTimeout(timeout);
        socket.off('message', onMessage);
        resolve(message as Record<string, unknown>);
      };
      socket.on('message', onMessage);
    });

    await request(socket, '2', 'turn/start', {
      input: [{ text: 'Question', type: 'text' }],
      threadId: 'one',
    });

    await expect(finalHistory).resolves.toMatchObject({ method: 'thread/updated' });
    expect(historyReads).toBeGreaterThanOrEqual(6);
    socket.close();
  });

  it('forwards the real run error in the completion notification', async () => {
    const api = createApi();
    vi.mocked(api.listSessions).mockReturnValue([
      {
        createdAt: 1_000,
        cwd: 'C:\\workspace',
        id: 'one',
        permissionMode: 'full',
        status: 'error',
        title: 'One',
        updatedAt: 2_000,
      },
    ]);
    vi.mocked(api.consumeTurnError).mockReturnValue('Provider quota exceeded.');
    server = new BrowserExtensionChatServer(api, token, '1.0.0');
    await server.start();
    const socket = await connect(server.getCapability().localAppServerUrl);
    await request(socket, '1', 'initialize');
    socket.send(JSON.stringify({ method: 'initialized' }));
    const completion = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for completion.')),
        3_000,
      );
      const onMessage = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.method !== 'turn/completed') return;
        clearTimeout(timeout);
        socket.off('message', onMessage);
        resolve(message);
      };
      socket.on('message', onMessage);
    });

    await request(socket, '2', 'turn/start', {
      input: [{ text: 'Question', type: 'text' }],
      threadId: 'one',
    });

    await expect(completion).resolves.toMatchObject({
      params: {
        turn: {
          error: { message: 'Provider quota exceeded.' },
          status: 'failed',
        },
      },
    });
    expect(api.consumeTurnError).toHaveBeenCalledWith('one', 'run-1');
    socket.close();
  });

  it('does not fail a turn while Gateway still reports the runtime as active', async () => {
    const api = createApi();
    let runtimeReads = 0;
    vi.mocked(api.listSessions).mockReturnValue([
      {
        createdAt: 1_000,
        cwd: 'C:\\workspace',
        id: 'one',
        permissionMode: 'full',
        status: 'error',
        title: 'One',
        updatedAt: 2_000,
      },
    ]);
    vi.mocked(api.getThreadRuntimeStatus).mockImplementation(async () => {
      runtimeReads += 1;
      return { known: true, running: runtimeReads < 4 };
    });
    vi.mocked(api.getMessages).mockImplementation(async () =>
      runtimeReads < 4
        ? [{ role: 'user', text: 'Question' }]
        : [
            { role: 'user', text: 'Question' },
            { role: 'assistant', text: 'Recovered answer' },
          ],
    );
    server = new BrowserExtensionChatServer(api, token, '1.0.0');
    await server.start();
    const socket = await connect(server.getCapability().localAppServerUrl);
    await request(socket, '1', 'initialize');
    socket.send(JSON.stringify({ method: 'initialized' }));
    const completion = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for completion.')),
        5_000,
      );
      const onMessage = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.method !== 'turn/completed') return;
        clearTimeout(timeout);
        socket.off('message', onMessage);
        resolve(message);
      };
      socket.on('message', onMessage);
    });

    await request(socket, '2', 'turn/start', {
      input: [{ text: 'Question', type: 'text' }],
      threadId: 'one',
    });

    await expect(completion).resolves.toMatchObject({
      params: { turn: { error: null, status: 'completed' } },
    });
    expect(api.getThreadRuntimeStatus).toHaveBeenCalledWith('one', { forceRefresh: true });
    socket.close();
  });

  it('projects thinking and tool activity into thread items', async () => {
    const api = createApi();
    vi.mocked(api.getMessages).mockResolvedValue([
      { role: 'user', text: 'Inspect it' },
      { role: 'assistant', text: '', thinking: 'I should read the file.' },
      {
        role: 'tool_use',
        text: '{"path":"notes.txt"}',
        toolInput: { path: 'notes.txt' },
        toolName: 'read',
        toolUseId: 'tool-1',
      },
      {
        role: 'tool_result',
        text: 'hello',
        isError: false,
        toolName: 'read',
        toolUseId: 'tool-1',
      },
      { role: 'assistant', text: 'Done' },
    ]);
    server = new BrowserExtensionChatServer(api, token, '1.0.0');
    await server.start();
    const socket = await connect(server.getCapability().localAppServerUrl);
    await request(socket, '1', 'initialize');
    socket.send(JSON.stringify({ method: 'initialized' }));

    await expect(
      request(socket, '2', 'thread/read', { includeTurns: true, threadId: 'one' }),
    ).resolves.toMatchObject({
      result: {
        thread: {
          turns: [
            {
              items: [
                { type: 'userMessage' },
                { content: ['I should read the file.'], type: 'reasoning' },
                {
                  input: { path: 'notes.txt' },
                  output: 'hello',
                  status: 'completed',
                  toolName: 'read',
                  type: 'toolCall',
                },
                { text: 'Done', type: 'agentMessage' },
              ],
            },
          ],
        },
      },
    });
    socket.close();
  });

  it('keeps the last successful history while transient refreshes fail', async () => {
    const api = createApi();
    let reads = 0;
    vi.mocked(api.getMessages).mockImplementation(async () => {
      reads += 1;
      if (reads === 1) return [{ role: 'user', text: 'Question' }];
      if (reads < 4) throw new Error('Temporary history failure.');
      return [
        { role: 'user', text: 'Question' },
        { role: 'assistant', text: 'Recovered answer' },
      ];
    });
    server = new BrowserExtensionChatServer(api, token, '1.0.0');
    await server.start();
    const socket = await connect(server.getCapability().localAppServerUrl);
    await request(socket, '1', 'initialize');
    socket.send(JSON.stringify({ method: 'initialized' }));
    const updates: Array<Record<string, unknown>> = [];
    const recovered = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for recovery.')), 4_000);
      socket.on('message', data => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.method !== 'thread/updated') return;
        updates.push(message);
        if (JSON.stringify(message).includes('Recovered answer')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await request(socket, '2', 'turn/start', {
      input: [{ text: 'Question', type: 'text' }],
      threadId: 'one',
    });
    await recovered;

    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0])).toContain('Recovered answer');
    socket.close();
  });

  it('uses delta reads during a running turn instead of rebuilding every poll', async () => {
    const api = createApi();
    vi.mocked(api.listSessions).mockReturnValue([
      {
        createdAt: 1_000,
        cwd: 'C:\\workspace',
        id: 'one',
        permissionMode: 'full',
        status: 'running',
        title: 'One',
        updatedAt: 2_000,
      },
    ]);
    vi.mocked(api.getThreadRuntimeStatus).mockResolvedValue({ known: true, running: true });
    server = new BrowserExtensionChatServer(api, token, '1.0.0');
    await server.start();
    const socket = await connect(server.getCapability().localAppServerUrl);
    await request(socket, '1', 'initialize');
    socket.send(JSON.stringify({ method: 'initialized' }));
    await request(socket, '2', 'turn/start', {
      input: [{ text: 'Question', type: 'text' }],
      threadId: 'one',
    });

    await new Promise(resolve => setTimeout(resolve, 1_200));

    const pollOptions = vi
      .mocked(api.getMessages)
      .mock.calls.slice(1)
      .map(([, options]) => options);
    expect(pollOptions.filter(options => options?.forceFullSnapshot === true)).toHaveLength(1);
    expect(pollOptions.some(options => options?.forceFullSnapshot === false)).toBe(true);
    socket.close();
  });

  it('does not send a turn when its baseline history cannot be established', async () => {
    const api = createApi();
    vi.mocked(api.getMessages).mockRejectedValue(new Error('History unavailable.'));
    server = new BrowserExtensionChatServer(api, token, '1.0.0');
    await server.start();
    const socket = await connect(server.getCapability().localAppServerUrl);
    await request(socket, '1', 'initialize');
    socket.send(JSON.stringify({ method: 'initialized' }));

    await expect(
      request(socket, '2', 'turn/start', {
        input: [{ text: 'Question', type: 'text' }],
        threadId: 'one',
      }),
    ).resolves.toMatchObject({ error: { message: 'History unavailable.' } });
    expect(api.sendMessage).not.toHaveBeenCalled();
    socket.close();
  });
});
