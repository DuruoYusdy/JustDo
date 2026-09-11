import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: never[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { MediaGenerationModelsIpc } from '../../../shared/mediaGenerationModels';
import { registerMediaGenerationModelHandlers } from './mediaGenerationModels';

describe('OpenClaw media generation model IPC', () => {
  const requestGateway = vi.fn();

  beforeEach(() => {
    handlers.clear();
    requestGateway.mockReset();
    registerMediaGenerationModelHandlers({ getRuntime: () => ({}) as never, requestGateway });
  });

  it('reads image generation model selection from Gateway config', async () => {
    requestGateway.mockResolvedValueOnce({
      config: {
        agents: {
          defaults: {
            mediaModels: {
              image: {
                primary: 'openai/gpt-image-2',
                fallbacks: ['google/gemini-3.1-flash-image'],
                timeoutMs: 120_000,
              },
            },
          },
        },
      },
    });

    await expect(
      handlers.get(MediaGenerationModelsIpc.GetConfiguration)?.({}, 'image'),
    ).resolves.toEqual({
      available: true,
      primary: 'openai/gpt-image-2',
      fallbacks: ['google/gemini-3.1-flash-image'],
      timeoutMs: 120_000,
    });
    expect(requestGateway).toHaveBeenCalledWith('config.get');
  });

  it('saves video generation model selection through Gateway config', async () => {
    requestGateway.mockResolvedValueOnce({ hash: 'config-hash' }).mockResolvedValueOnce({ ok: true });

    await handlers.get(MediaGenerationModelsIpc.SaveConfiguration)?.(
      {},
      'video',
      {
        primary: 'google/veo-3.1-fast-generate-preview',
        fallbacks: ['openai/sora-2'],
        timeoutMs: 300_000,
      },
    );

    expect(requestGateway.mock.calls[1]?.[0]).toBe('config.patch');
    expect(requestGateway.mock.calls[1]?.[1]).toMatchObject({ baseHash: 'config-hash' });
    expect(JSON.parse((requestGateway.mock.calls[1]?.[1] as { raw: string }).raw)).toEqual({
      agents: {
        defaults: {
          mediaModels: {
            video: {
              primary: 'google/veo-3.1-fast-generate-preview',
              fallbacks: ['openai/sora-2'],
              timeoutMs: 300_000,
            },
          },
        },
      },
    });
  });

  it('rejects unsupported categories before contacting Gateway', async () => {
    await expect(
      handlers.get(MediaGenerationModelsIpc.SaveConfiguration)?.(
        {},
        'document',
        { primary: 'provider/model', fallbacks: [] },
      ),
    ).rejects.toThrow('Invalid media generation model kind.');
    expect(requestGateway).not.toHaveBeenCalled();
  });

  it('removes the category override when the model list is empty', async () => {
    requestGateway.mockResolvedValueOnce({ hash: 'config-hash' }).mockResolvedValueOnce({ ok: true });

    await handlers.get(MediaGenerationModelsIpc.SaveConfiguration)?.(
      {},
      'music',
      { primary: '', fallbacks: [] },
    );

    expect(JSON.parse((requestGateway.mock.calls[1]?.[1] as { raw: string }).raw)).toEqual({
      agents: { defaults: { mediaModels: { music: null } } },
    });
  });

  it('applies a user-owned OpenAI-compatible intranet endpoint through Gateway config', async () => {
    requestGateway
      .mockResolvedValueOnce({
        hash: 'config-hash',
      })
      .mockResolvedValueOnce({ ok: true });

    await handlers.get(MediaGenerationModelsIpc.SaveConfiguration)?.(
      {},
      'image',
      {
        primary: 'openai/local-image',
        fallbacks: [],
        baseUrl: 'http://image.lan/v1',
        apiKey: 'local-key',
      },
    );

    expect(JSON.parse((requestGateway.mock.calls[1]?.[1] as { raw: string }).raw)).toMatchObject({
      agents: {
        defaults: {
          mediaModels: { image: { primary: 'openai/local-image' } },
        },
      },
      models: {
        providers: {
          'justdo-image-openai': {
            baseUrl: 'http://image.lan/v1',
            apiKey: 'local-key',
            api: 'openai-completions',
            request: { allowPrivateNetwork: true },
          },
        },
      },
      plugins: { entries: { openai: { enabled: true } } },
    });
  });

  it('keeps language, image, and video OpenAI-compatible endpoints isolated', async () => {
    requestGateway
      .mockResolvedValueOnce({ hash: 'image-hash' })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ hash: 'video-hash' })
      .mockResolvedValueOnce({ ok: true });

    await handlers.get(MediaGenerationModelsIpc.SaveConfiguration)?.({}, 'image', {
      primary: 'openai/image-model',
      fallbacks: [],
      baseUrl: 'http://image.lan/v1',
      apiKey: 'image-key',
    });
    await handlers.get(MediaGenerationModelsIpc.SaveConfiguration)?.({}, 'video', {
      primary: 'openai/video-model',
      fallbacks: [],
      baseUrl: 'http://video.lan/v1',
      apiKey: 'video-key',
    });

    const imagePatch = JSON.parse((requestGateway.mock.calls[1]?.[1] as { raw: string }).raw);
    const videoPatch = JSON.parse((requestGateway.mock.calls[3]?.[1] as { raw: string }).raw);
    expect(imagePatch.models.providers).toEqual({
      'justdo-image-openai': expect.objectContaining({
        baseUrl: 'http://image.lan/v1',
        apiKey: 'image-key',
      }),
    });
    expect(videoPatch.models.providers).toEqual({
      'justdo-video-openai': expect.objectContaining({
        baseUrl: 'http://video.lan/v1',
        apiKey: 'video-key',
      }),
    });
    expect(imagePatch.models.providers).not.toHaveProperty('openai');
    expect(videoPatch.models.providers).not.toHaveProperty('openai');
  });
});
