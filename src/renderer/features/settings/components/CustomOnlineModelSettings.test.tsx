// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { currentConfig, updateConfig } = vi.hoisted(() => ({
  currentConfig: { onlineModelProviders: {}, voice: {} } as Record<string, unknown>,
  updateConfig: vi.fn(),
}));

vi.mock('@/services/config', () => ({
  configService: {
    getConfig: () => currentConfig,
    updateConfig,
  },
}));

vi.mock('@/services/i18n', () => ({
  i18nService: { t: (key: string) => key },
}));

import CustomOnlineModelSettings, {
  buildCustomOnlineEndpointPreview,
  buildCustomOnlineModelsUrl,
  normalizeCustomOnlineBaseUrl,
  parseDiscoveredVoices,
  parseOpenApiDefaultModels,
} from './CustomOnlineModelSettings';
import { buildVoiceDiscoveryUrls } from './customOnlineModelUrls';

afterEach(cleanup);

describe('CustomOnlineModelSettings', () => {
  const saveConfiguration = vi.fn();
  const fetch = vi.fn();

  beforeEach(() => {
    updateConfig.mockReset().mockResolvedValue(undefined);
    currentConfig.onlineModelProviders = {};
    currentConfig.voice = {};
    saveConfiguration.mockReset().mockResolvedValue(undefined);
    fetch.mockReset();
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        api: { fetch, cancelFetch: vi.fn().mockResolvedValue(undefined) },
        onlineAsr: { saveConfiguration, clearConfiguration: vi.fn().mockResolvedValue(undefined) },
        onlineTts: {
          saveConfiguration: vi.fn(),
          clearConfiguration: vi.fn().mockResolvedValue(undefined),
        },
        mediaGenerationModels: { saveConfiguration: vi.fn() },
      },
    });
  });

  it('builds capability-specific endpoint previews', () => {
    expect(buildCustomOnlineEndpointPreview('speech-synthesis', 'http://speech.lan/v1/')).toBe(
      'http://speech.lan/v1/audio/speech',
    );
    expect(buildCustomOnlineEndpointPreview('image', 'https://media.test/v1')).toBe(
      'https://media.test/v1/images/generations',
    );
    expect(buildCustomOnlineEndpointPreview('video', 'https://media.test/v1')).toBe(
      'https://media.test/v1/videos',
    );
    expect(buildCustomOnlineEndpointPreview('speech-recognition', 'http://speech.lan/v1')).toBe(
      'ws://speech.lan/v1/realtime?intent=transcription',
    );
    expect(
      buildCustomOnlineEndpointPreview(
        'speech-synthesis',
        'http://speech.lan/v1/audio/speech?token=value#section',
      ),
    ).toBe('http://speech.lan/v1/audio/speech?token=value');
    expect(
      normalizeCustomOnlineBaseUrl(
        'speech-synthesis',
        'http://speech.lan/v1/audio/speech?token=value',
      ),
    ).toBe('http://speech.lan/v1?token=value');
    expect(
      buildCustomOnlineModelsUrl(
        'speech-synthesis',
        'http://speech.lan/v1/audio/speech?token=value',
      ),
    ).toBe('http://speech.lan/v1/models?token=value');
    expect(
      normalizeCustomOnlineBaseUrl(
        'speech-synthesis',
        'http://speech.lan/v1/audio/speech?token=/',
      ),
    ).toBe('http://speech.lan/v1?token=/');
    expect(buildVoiceDiscoveryUrls('http://speech.lan/v2/audio/speech')).toEqual([
      'http://speech.lan/v2/audio/voices',
      'http://speech.lan/v2/voices',
      'http://speech.lan/api/voices',
    ]);
  });

  it('parses common custom-provider voice catalog shapes for a model', () => {
    expect(
      parseDiscoveredVoices(
        {
          data: [
            { id: 'tts-pro', voices: ['nova', { id: 'calm', name: 'Calm' }] },
            { id: 'other-model', voices: ['ignored'] },
          ],
        },
        'tts-pro',
      ),
    ).toEqual([
      { id: 'nova', name: 'nova' },
      { id: 'calm', name: 'Calm' },
    ]);
    expect(
      parseDiscoveredVoices(
        { voices: [{ voice_id: 'speaker-1', label: 'Speaker One', models: ['tts-pro'] }] },
        'tts-pro',
      ),
    ).toEqual([{ id: 'speaker-1', name: 'Speaker One' }]);
    expect(
      parseDiscoveredVoices(
        {
          builtins: ['Junhao'],
          custom: [{ id: 'voice-clone-id', name: 'Junhao clone' }],
        },
        'tts-pro',
      ),
    ).toEqual([
      { id: 'Junhao', name: 'Junhao' },
      { id: 'voice-clone-id', name: 'Junhao clone' },
    ]);
    expect(
      parseDiscoveredVoices(
        { data: { voices: { calm: 'Calm voice', bright: { label: 'Bright voice' } } } },
        'tts-pro',
      ),
    ).toEqual([
      { id: 'calm', name: 'Calm voice' },
      { id: 'bright', name: 'Bright voice' },
    ]);
    expect(
      parseDiscoveredVoices(
        { data: { builtins: ['Junhao'], custom: { clone: { name: 'Clone' } } } },
        'tts-pro',
      ),
    ).toEqual([
      { id: 'Junhao', name: 'Junhao' },
      { id: 'clone', name: 'Clone' },
    ]);
    expect(
      parseDiscoveredVoices(
        { data: [{ id: 'tts-pro', voices: { calm: 'Calm voice' } }] },
        'tts-pro',
      ),
    ).toEqual([{ id: 'calm', name: 'Calm voice' }]);
    expect(
      parseDiscoveredVoices(['plain', { id: 'plain', name: 'Preferred name' }], 'tts-pro'),
    ).toEqual([{ id: 'plain', name: 'Preferred name' }]);
  });

  it('discovers a default model and voice from an OpenAPI request schema', () => {
    expect(
      parseOpenApiDefaultModels(
        {
          paths: {
            '/v1/audio/speech': {
              post: {
                requestBody: {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/SpeechRequest' },
                    },
                  },
                },
              },
            },
          },
          components: {
            schemas: {
              SpeechRequest: {
                properties: {
                  model: { type: 'string', default: 'moss-tts-nano-onnx' },
                  voice: { type: 'string', default: 'Junhao' },
                },
              },
            },
          },
        },
        'speech-synthesis',
        'http://127.0.0.1:18084/v1/audio/speech',
      ),
    ).toEqual([
      { id: 'moss-tts-nano-onnx', name: 'moss-tts-nano-onnx', voice: 'Junhao' },
    ]);
  });

  it('starts empty and lets the user create a provider and its models', async () => {
    render(<CustomOnlineModelSettings kind="speech-recognition" />);

    expect(screen.getByText('customModelNoProviders')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /addCustomProvider/ }));
    fireEvent.change(screen.getByLabelText('customDisplayName'), {
      target: { value: 'Office Speech' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    fireEvent.change(screen.getByLabelText('baseUrl'), {
      target: { value: 'http://speech.lan/v1' },
    });
    fireEvent.change(screen.getByLabelText('apiKey'), { target: { value: 'local-key' } });
    fireEvent.click(screen.getByRole('button', { name: /manualAddModel/ }));
    fireEvent.change(screen.getByLabelText('mediaModelId'), {
      target: { value: 'whisper-local' },
    });
    fireEvent.change(screen.getByLabelText('modelName'), {
      target: { value: 'Whisper Local' },
    });
    const confirmButtons = screen.getAllByRole('button', { name: 'confirm' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    fireEvent.click(screen.getByRole('button', { name: 'mediaModelSetDefault' }));
    fireEvent.click(screen.getByRole('button', { name: /mediaModelSave/ }));

    await waitFor(() =>
      expect(saveConfiguration).toHaveBeenCalledWith({
        provider: 'openai',
        baseUrl: 'http://speech.lan/v1',
        apiKey: 'local-key',
        model: 'whisper-local',
      }),
    );
    expect(updateConfig).toHaveBeenCalled();
  });

  it('persists and clears Gateway state when the last provider is deleted', async () => {
    currentConfig.onlineModelProviders = {
      'speech-recognition': {
        defaultProviderId: 'office',
        providers: {
          office: {
            displayName: 'Office Speech',
            baseUrl: 'http://speech.lan/v1',
            apiKey: 'key',
            defaultModel: 'whisper',
            models: [{ id: 'whisper', name: 'Whisper' }],
          },
        },
      },
    };

    render(<CustomOnlineModelSettings kind="speech-recognition" />);
    fireEvent.click(screen.getByRole('button', { name: 'deleteCustomProvider: Office Speech' }));

    await waitFor(() => expect(window.electron.onlineAsr.clearConfiguration).toHaveBeenCalled());
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        onlineModelProviders: expect.objectContaining({
          'speech-recognition': { providers: {} },
        }),
      }),
    );
    expect(screen.getByText('customModelNoProviders')).toBeTruthy();
  });

  it('validates provider names and rejects duplicates', () => {
    currentConfig.onlineModelProviders = {
      image: {
        providers: {
          existing: {
            displayName: 'Media API',
            baseUrl: 'http://media.lan/v1',
            apiKey: '',
            models: [],
          },
        },
      },
    };
    render(<CustomOnlineModelSettings kind="image" />);

    fireEvent.click(screen.getByRole('button', { name: /addCustomProvider/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('customDisplayName'), {
      target: { value: '中文供应商' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));
    expect(screen.getByText('providerNameInvalid')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('customDisplayName'), {
      target: { value: 'media api' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));
    expect(screen.getByText('providerNameExists')).toBeTruthy();
  });

  it('auto-detects models from the provider models endpoint', async () => {
    currentConfig.onlineModelProviders = {
      image: {
        providers: {
          media: {
            displayName: 'Media API',
            baseUrl: 'https://media.lan/v1',
            apiKey: 'secret',
            models: [{ id: 'manual-model', name: 'Manual model' }],
          },
        },
      },
    };
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: { data: [{ id: 'image-pro', name: 'Image Pro' }] },
    });
    render(<CustomOnlineModelSettings kind="image" />);

    expect(screen.getByTitle('https://media.lan/v1/images/generations')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'detectModels' }));

    await waitFor(() => expect(screen.getByText('Image Pro')).toBeTruthy());
    expect(screen.getByText('Manual model')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://media.lan/v1/models',
        method: 'GET',
        headers: { Authorization: 'Bearer secret' },
        requestId: expect.any(String),
      }),
    );
  });

  it('falls back to OpenAPI discovery for a custom speech service without /models', async () => {
    currentConfig.onlineModelProviders = {
      'speech-synthesis': {
        providers: {
          moss: {
            displayName: 'MOSS TTS',
            baseUrl: 'http://127.0.0.1:18084/v1/audio/speech',
            apiKey: '',
            models: [],
          },
        },
      },
    };
    fetch
      .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        data: {
          paths: {
            '/v1/audio/speech': {
              post: {
                requestBody: {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/SpeechRequest' },
                    },
                  },
                },
              },
            },
          },
          components: {
            schemas: {
              SpeechRequest: {
                properties: {
                  model: { default: 'moss-tts-nano-onnx' },
                  voice: { default: 'Junhao' },
                },
              },
            },
          },
        },
      });
    render(<CustomOnlineModelSettings kind="speech-synthesis" />);

    fireEvent.click(screen.getByRole('button', { name: 'detectModels' }));

    await waitFor(() => expect(screen.getAllByText('moss-tts-nano-onnx')).toHaveLength(2));
    expect(screen.getByText('voiceSpeaker: Junhao')).toBeTruthy();
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ url: 'http://127.0.0.1:18084/openapi.json' }),
    );
  });

  it('stores speech synthesis voices on each model and applies the selected model voice', async () => {
    currentConfig.onlineModelProviders = {
      'speech-synthesis': {
        defaultProviderId: 'speech',
        providers: {
          speech: {
            displayName: 'Speech API',
            baseUrl: 'http://speech.lan/v1/audio/speech',
            apiKey: '',
            defaultModel: 'tts-pro',
            models: [{ id: 'tts-pro', name: 'TTS Pro', voice: 'nova' }],
          },
        },
      },
    };
    const saveTtsConfiguration = vi.fn().mockResolvedValue(undefined);
    window.electron.onlineTts.saveConfiguration = saveTtsConfiguration;
    render(<CustomOnlineModelSettings kind="speech-synthesis" />);

    expect(screen.getByText('voiceSpeaker: nova')).toBeTruthy();
    expect(screen.queryByLabelText('voiceSpeaker')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'editModel: TTS Pro' }));
    expect((screen.getByLabelText('voiceSpeaker') as HTMLInputElement).value).toBe('nova');
    fetch
      .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
      .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        data: { builtins: ['calm'], custom: [{ id: 'clone', name: 'Cloned voice' }] },
      });
    fireEvent.click(screen.getByRole('button', { name: 'detectVoices' }));
    await waitFor(() => expect(screen.getByText('voiceDetectionSummary')).toBeTruthy());
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ url: 'http://speech.lan/v1/audio/voices', method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ url: 'http://speech.lan/v1/voices', method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ url: 'http://speech.lan/api/voices', method: 'GET' }),
    );
    expect(document.querySelector('option[value="calm"]')?.getAttribute('label')).toBe('calm');
    expect(document.querySelector('option[value="clone"]')?.getAttribute('label')).toBe(
      'Cloned voice',
    );
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    fireEvent.click(screen.getByRole('button', { name: /mediaModelSave/ }));

    await waitFor(() =>
      expect(saveTtsConfiguration).toHaveBeenCalledWith({
        provider: 'openai',
        baseUrl: 'http://speech.lan/v1',
        apiKey: 'local',
        model: 'tts-pro',
        voice: 'nova',
      }),
    );
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        onlineModelProviders: expect.objectContaining({
          'speech-synthesis': expect.objectContaining({
            providers: expect.objectContaining({
              speech: expect.objectContaining({ baseUrl: 'http://speech.lan/v1' }),
            }),
          }),
        }),
      }),
    );
  });

  it('ignores stale voice discovery after the model ID changes', async () => {
    currentConfig.onlineModelProviders = {
      'speech-synthesis': {
        providers: {
          speech: {
            displayName: 'Speech API',
            baseUrl: 'http://speech.lan/v1',
            apiKey: '',
            defaultModel: 'tts-old',
            models: [{ id: 'tts-old', name: 'Old TTS', voice: 'old-voice' }],
          },
        },
      },
    };
    let resolveFetch: ((value: unknown) => void) | undefined;
    fetch.mockReturnValueOnce(new Promise(resolve => (resolveFetch = resolve)));
    render(<CustomOnlineModelSettings kind="speech-synthesis" />);
    fireEvent.click(screen.getByRole('button', { name: 'editModel: Old TTS' }));
    fireEvent.click(screen.getByRole('button', { name: 'detectVoices' }));

    fireEvent.change(screen.getByLabelText('mediaModelId'), { target: { value: 'tts-new' } });
    await act(async () => {
      resolveFetch?.({
        ok: true,
        status: 200,
        statusText: 'OK',
        data: { voices: ['stale-voice'] },
      });
      await Promise.resolve();
    });

    expect(window.electron.api.cancelFetch).toHaveBeenCalled();
    expect(document.querySelector('option[value="stale-voice"]')).toBeNull();
  });

  it('does not submit an invalid category default while another provider is active', () => {
    currentConfig.onlineModelProviders = {
      'speech-synthesis': {
        defaultProviderId: 'broken',
        providers: {
          ready: {
            displayName: 'Ready Speech',
            baseUrl: 'http://ready.lan/v1',
            apiKey: '',
            defaultModel: 'tts-ready',
            models: [{ id: 'tts-ready', name: 'Ready TTS', voice: 'ready-voice' }],
          },
          broken: {
            displayName: 'Broken Speech',
            baseUrl: 'http://broken.lan/v1',
            apiKey: '',
            defaultModel: 'tts-broken',
            models: [{ id: 'tts-broken', name: 'Broken TTS' }],
          },
        },
      },
    };
    render(<CustomOnlineModelSettings kind="speech-synthesis" />);

    expect(screen.getByText('customModelProviderInvalid')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /mediaModelSave/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
