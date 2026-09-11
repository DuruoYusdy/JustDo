import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: never[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { OnlineTtsIpc } from '../../../shared/onlineTts';
import { registerOnlineTtsHandlers } from './onlineTts';

describe('OpenClaw online speech IPC', () => {
  const requestGateway = vi.fn();

  beforeEach(() => {
    handlers.clear();
    requestGateway.mockReset();
    registerOnlineTtsHandlers({ getRuntime: () => ({}) as never, requestGateway });
  });

  it('uses OpenAI as the default online speech protocol', async () => {
    requestGateway
      .mockResolvedValueOnce({ active: 'tts-local-cli', providers: [] })
      .mockResolvedValueOnce({ config: {} });

    const configuration = await handlers.get(OnlineTtsIpc.GetConfiguration)?.();

    expect(configuration).toMatchObject({ selectedProvider: 'openai', available: false });
    expect(configuration).not.toHaveProperty('provider');
    expect((configuration as { providers: unknown[] }).providers[0]).toMatchObject({
      id: 'openai',
      defaultModel: 'gpt-4o-mini-tts',
      defaultVoice: 'coral',
    });
  });

  it('reads an explicitly configured intranet OpenAI speech service', async () => {
    requestGateway
      .mockResolvedValueOnce({
        active: 'openai',
        providers: [{ id: 'openai', name: 'OpenAI', configured: true }],
      })
      .mockResolvedValueOnce({
        config: {
          tts: {
            provider: 'openai',
            providers: {
              openai: {
                baseUrl: 'http://speech.internal:8000/v1',
                model: 'internal-tts',
                voice: 'speaker-1',
              },
            },
          },
        },
      });

    await expect(handlers.get(OnlineTtsIpc.GetConfiguration)?.()).resolves.toMatchObject({
      available: true,
      provider: 'openai',
      selectedProvider: 'openai',
      baseUrl: 'http://speech.internal:8000/v1',
      model: 'internal-tts',
      voice: 'speaker-1',
      credentialConfigured: true,
    });
  });

  it('saves OpenAI-compatible speech settings through Gateway config', async () => {
    requestGateway
      .mockResolvedValueOnce({
        providers: [{ id: 'openai', name: 'OpenAI', configured: false }],
      })
      .mockResolvedValueOnce({ hash: 'config-hash' })
      .mockResolvedValueOnce({ ok: true });

    await handlers.get(OnlineTtsIpc.SaveConfiguration)?.(
      {},
      {
        provider: 'openai',
        baseUrl: 'http://speech.internal:8000/v1',
        apiKey: 'secret',
        model: 'internal-tts',
        voice: 'speaker-1',
      },
    );

    expect(requestGateway.mock.calls[2]?.[0]).toBe('config.patch');
    expect(JSON.parse((requestGateway.mock.calls[2]?.[1] as { raw: string }).raw)).toMatchObject({
      tts: {
        auto: 'off',
        provider: 'openai',
        providers: {
          openai: {
            baseUrl: 'http://speech.internal:8000/v1',
            apiKey: 'secret',
            model: 'internal-tts',
            voice: 'speaker-1',
          },
        },
      },
      plugins: { entries: { openai: { enabled: true } } },
    });
  });

  it('maps ElevenLabs model and voice field names', async () => {
    requestGateway
      .mockResolvedValueOnce({
        providers: [{ id: 'elevenlabs', name: 'ElevenLabs', configured: false }],
      })
      .mockResolvedValueOnce({ hash: 'config-hash' })
      .mockResolvedValueOnce({ ok: true });

    await handlers.get(OnlineTtsIpc.SaveConfiguration)?.(
      {},
      {
        provider: 'elevenlabs',
        baseUrl: 'http://speech.internal:8001',
        apiKey: 'secret',
        model: 'eleven_multilingual_v2',
        voice: 'voice-id',
      },
    );

    const raw = JSON.parse((requestGateway.mock.calls[2]?.[1] as { raw: string }).raw) as {
      tts: { providers: { elevenlabs: Record<string, unknown> } };
    };
    expect(raw.tts.providers.elevenlabs).toMatchObject({
      modelId: 'eleven_multilingual_v2',
      voiceId: 'voice-id',
    });
  });

  it('requires the API key again when the speech service URL changes', async () => {
    requestGateway
      .mockResolvedValueOnce({
        providers: [{ id: 'openai', name: 'OpenAI', configured: true }],
      })
      .mockResolvedValueOnce({
        hash: 'config-hash',
        config: {
          tts: {
            provider: 'openai',
            providers: {
              openai: { baseUrl: 'http://old.internal:8000', model: 'model', voice: 'voice' },
            },
          },
        },
      });

    await expect(
      handlers.get(OnlineTtsIpc.SaveConfiguration)?.(
        {},
        {
          provider: 'openai',
          baseUrl: 'http://new.internal:8000',
          model: 'model',
          voice: 'voice',
        },
      ),
    ).rejects.toThrow(/API key/i);
    expect(requestGateway).not.toHaveBeenCalledWith('config.patch', expect.anything());
  });
});
