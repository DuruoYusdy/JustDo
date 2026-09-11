import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: never[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { OnlineAsrIpc } from '../../../shared/onlineAsr';
import { registerOnlineAsrHandlers } from './onlineAsr';

describe('OpenClaw online transcription IPC', () => {
  const runtime = new EventEmitter();
  const requestGateway = vi.fn();
  const send = vi.fn();
  const sender = {
    isDestroyed: () => false,
    once: vi.fn(),
    send,
  };

  beforeEach(() => {
    handlers.clear();
    requestGateway.mockReset();
    send.mockReset();
    sender.once.mockReset();
    runtime.removeAllListeners();
    registerOnlineAsrHandlers({ getRuntime: () => runtime as never, requestGateway });
  });

  it('uses OpenAI as the default online transcription protocol', async () => {
    requestGateway
      .mockResolvedValueOnce({ transcription: { ready: false, providers: [] } })
      .mockResolvedValueOnce({ config: {} });

    const configuration = await handlers.get(OnlineAsrIpc.GetConfiguration)?.();

    expect(configuration).toMatchObject({ selectedProvider: 'openai' });
    expect((configuration as { providers: unknown[] }).providers[0]).toMatchObject({
      id: 'openai',
      defaultModel: 'gpt-4o-transcribe',
    });
  });

  it('reports the configured Gateway transcription provider', async () => {
    requestGateway.mockImplementation((method: string) => {
      if (method === 'talk.catalog') {
        return Promise.resolve({
          transcription: {
            ready: true,
            activeProvider: 'deepgram',
            providers: [{ id: 'deepgram', configured: true }],
          },
        });
      }
      return Promise.resolve({
        config: {
          plugins: {
            entries: {
              'voice-call': {
                config: {
                  streaming: {
                    provider: 'deepgram',
                    providers: {
                      deepgram: { baseUrl: 'ws://speech.internal:8000', model: 'nova-3' },
                    },
                  },
                },
              },
            },
          },
        },
      });
    });

    await expect(handlers.get(OnlineAsrIpc.GetStatus)?.()).resolves.toEqual({
      available: true,
      provider: 'deepgram',
    });
    expect(requestGateway).toHaveBeenCalledWith('talk.catalog', {});
  });

  it('returns provider choices and the selected online transcription model', async () => {
    requestGateway
      .mockResolvedValueOnce({
        transcription: {
          ready: true,
          activeProvider: 'deepgram',
          providers: [
            {
              id: 'deepgram',
              label: 'Deepgram',
              configured: true,
              defaultModel: 'nova-3',
              models: ['nova-3'],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        config: {
          plugins: {
            entries: {
              'voice-call': {
                config: {
                  streaming: {
                    provider: 'deepgram',
                    providers: {
                      deepgram: {
                        baseUrl: 'ws://speech.internal:8000',
                        model: 'nova-3-medical',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

    const configuration = await handlers.get(OnlineAsrIpc.GetConfiguration)?.();
    expect(configuration).toMatchObject({
      available: true,
      selectedProvider: 'deepgram',
      baseUrl: 'ws://speech.internal:8000',
      model: 'nova-3-medical',
      credentialConfigured: true,
    });
    expect((configuration as { providers: unknown[] }).providers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'deepgram', defaultModel: 'nova-3' })]),
    );
  });

  it('saves provider credentials through an atomic Gateway config patch', async () => {
    requestGateway
      .mockResolvedValueOnce({
        transcription: {
          providers: [{ id: 'deepgram', label: 'Deepgram', configured: false }],
        },
      })
      .mockResolvedValueOnce({ hash: 'config-hash' })
      .mockResolvedValueOnce({ ok: true });

    await handlers.get(OnlineAsrIpc.SaveConfiguration)?.(
      { sender },
      {
        provider: 'deepgram',
        baseUrl: 'ws://speech.internal:8000',
        apiKey: 'secret',
        model: 'nova-3',
      },
    );

    const patchCall = requestGateway.mock.calls[2];
    expect(patchCall?.[0]).toBe('config.patch');
    expect(patchCall?.[1]).toMatchObject({ baseHash: 'config-hash' });
    expect(JSON.parse((patchCall?.[1] as { raw: string }).raw)).toMatchObject({
      plugins: {
        entries: {
          'voice-call': {
            config: {
              streaming: {
                provider: 'deepgram',
                providers: {
                  deepgram: {
                    baseUrl: 'ws://speech.internal:8000',
                    apiKey: 'secret',
                    model: 'nova-3',
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('requires the API key again when the transcription service URL changes', async () => {
    requestGateway
      .mockResolvedValueOnce({
        transcription: {
          providers: [{ id: 'openai', label: 'OpenAI', configured: true }],
        },
      })
      .mockResolvedValueOnce({
        hash: 'config-hash',
        config: {
          plugins: {
            entries: {
              'voice-call': {
                config: {
                  streaming: {
                    provider: 'openai',
                    providers: {
                      openai: { baseUrl: 'ws://old.internal:8000', model: 'model' },
                    },
                  },
                },
              },
            },
          },
        },
      });

    await expect(
      handlers.get(OnlineAsrIpc.SaveConfiguration)?.(
        { sender },
        {
          provider: 'openai',
          baseUrl: 'ws://new.internal:8000',
          model: 'model',
        },
      ),
    ).rejects.toThrow(/API key/i);
    expect(requestGateway).not.toHaveBeenCalledWith('config.patch', expect.anything());
  });

  it('creates an exact OpenClaw transcription relay and forwards only its events', async () => {
    requestGateway.mockImplementation((method: string) => {
      if (method === 'talk.catalog') {
        return Promise.resolve({
          transcription: {
            ready: true,
            activeProvider: 'deepgram',
            providers: [{ id: 'deepgram', configured: true }],
          },
        });
      }
      if (method === 'config.get') {
        return Promise.resolve({
          config: {
            plugins: {
              entries: {
                'voice-call': {
                  config: {
                    streaming: {
                      provider: 'deepgram',
                      providers: {
                        deepgram: { baseUrl: 'ws://speech.internal:8000', model: 'nova-3' },
                      },
                    },
                  },
                },
              },
            },
          },
        });
      }
      return Promise.resolve({
        sessionId: 'talk-1',
        transcriptionSessionId: 'transcription-1',
        provider: 'deepgram',
        audio: { inputEncoding: 'g711_ulaw', inputSampleRateHz: 8000 },
      });
    });
    const start = handlers.get(OnlineAsrIpc.Start);

    await expect(start?.({ sender }, { language: 'zh' })).resolves.toMatchObject({
      sessionId: 'talk-1',
      transcriptionSessionId: 'transcription-1',
      inputEncoding: 'g711_ulaw',
      inputSampleRateHz: 8000,
    });
    expect(requestGateway).toHaveBeenCalledWith('talk.session.create', {
      mode: 'transcription',
      transport: 'gateway-relay',
      brain: 'none',
      language: 'zh',
    });

    runtime.emit('gatewayEvent', {
      event: 'talk.event',
      payload: { transcriptionSessionId: 'other', type: 'transcript', text: 'ignored' },
    });
    runtime.emit('gatewayEvent', {
      event: 'talk.event',
      payload: {
        transcriptionSessionId: 'transcription-1',
        type: 'transcript',
        text: '你好',
        final: true,
      },
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(OnlineAsrIpc.Event, {
      transcriptionSessionId: 'transcription-1',
      type: 'transcript',
      text: '你好',
      final: true,
    });
  });

  it('rejects audio sent by a renderer that does not own the Talk session', async () => {
    requestGateway.mockImplementation((method: string) => {
      if (method === 'talk.catalog') {
        return Promise.resolve({
          transcription: {
            ready: true,
            activeProvider: 'deepgram',
            providers: [{ id: 'deepgram', configured: true }],
          },
        });
      }
      if (method === 'config.get') {
        return Promise.resolve({
          config: {
            plugins: {
              entries: {
                'voice-call': {
                  config: {
                    streaming: {
                      provider: 'deepgram',
                      providers: {
                        deepgram: { baseUrl: 'ws://speech.internal:8000', model: 'nova-3' },
                      },
                    },
                  },
                },
              },
            },
          },
        });
      }
      return Promise.resolve({
        sessionId: 'talk-1',
        audio: { inputEncoding: 'g711_ulaw', inputSampleRateHz: 8000 },
      });
    });
    await handlers.get(OnlineAsrIpc.Start)?.({ sender }, { language: 'auto' });

    await expect(
      handlers.get(OnlineAsrIpc.AppendAudio)?.({ sender: {} }, 'talk-1', 'AQ=='),
    ).rejects.toThrow('Invalid online transcription audio request.');
  });
});
