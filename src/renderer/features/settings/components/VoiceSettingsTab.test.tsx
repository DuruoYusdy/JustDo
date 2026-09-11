// @vitest-environment jsdom

import { defaultLocalSpeechSettings } from '@shared/localSpeechSettings';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import VoiceSettingsTab from './VoiceSettingsTab';

afterEach(cleanup);

describe('VoiceSettingsTab', () => {
  it('shows local model status and exposes both feature switches', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        localSpeechModels: {
          list: vi.fn().mockResolvedValue({
            supported: true,
            models: [
              {
                id: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
                kind: 'asr',
                phase: 'ready',
                installed: true,
              },
              {
                id: 'kokoro-int8-multi-lang-v1_1',
                kind: 'tts',
                phase: 'ready',
                installed: true,
              },
            ],
          }),
          install: vi.fn(),
          onChanged: vi.fn().mockReturnValue(() => undefined),
        },
      },
    });
    const onChange = vi.fn();

    render(<VoiceSettingsTab value={defaultLocalSpeechSettings} onChange={onChange} />);

    expect(await screen.findAllByText(i18nService.t('voiceModelReady'))).toHaveLength(2);
    fireEvent.click(screen.getByRole('switch', { name: i18nService.t('voiceInputEnabled') }));
    expect(onChange).toHaveBeenCalledWith({
      ...defaultLocalSpeechSettings,
      inputEnabled: true,
    });
    expect(screen.getByRole('switch', { name: i18nService.t('voiceOutputEnabled') })).toBeTruthy();
  });

  it('waits for an explicit download after voice input is enabled', async () => {
    const install = vi.fn().mockResolvedValue({
      success: true,
      status: {
        id: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
        kind: 'asr',
        phase: 'ready',
        installed: true,
      },
    });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        localSpeechModels: {
          list: vi.fn().mockResolvedValue({
            supported: true,
            models: [
              {
                id: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
                kind: 'asr',
                phase: 'not-installed',
                installed: false,
              },
            ],
          }),
          install,
          onChanged: vi.fn().mockReturnValue(() => undefined),
        },
      },
    });

    const { rerender } = render(
      <VoiceSettingsTab value={defaultLocalSpeechSettings} onChange={vi.fn()} />,
    );
    await screen.findAllByText(i18nService.t('voiceModelNotInstalled'));
    fireEvent.click(screen.getByRole('switch', { name: i18nService.t('voiceInputEnabled') }));

    expect(install).not.toHaveBeenCalled();
    rerender(
      <VoiceSettingsTab
        value={{ ...defaultLocalSpeechSettings, inputEnabled: true }}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: i18nService.t('voiceModelDownload') }));
    expect(install).toHaveBeenCalledWith(
      'asr',
      'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
    );
  });

  it('shows model download actions only for enabled speech features', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        localSpeechModels: {
          list: vi.fn().mockResolvedValue({
            supported: true,
            models: [
              {
                id: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
                kind: 'asr',
                phase: 'not-installed',
                installed: false,
              },
              {
                id: 'kokoro-int8-multi-lang-v1_1',
                kind: 'tts',
                phase: 'not-installed',
                installed: false,
              },
            ],
          }),
          install: vi.fn().mockResolvedValue({
            success: false,
            status: {
              id: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
              kind: 'asr',
              phase: 'not-installed',
              installed: false,
            },
          }),
          onChanged: vi.fn().mockReturnValue(() => undefined),
        },
      },
    });

    const { rerender } = render(
      <VoiceSettingsTab value={defaultLocalSpeechSettings} onChange={vi.fn()} />,
    );
    await screen.findAllByText(i18nService.t('voiceModelNotInstalled'));
    expect(screen.queryByRole('button', { name: i18nService.t('voiceModelDownload') })).toBeNull();

    rerender(
      <VoiceSettingsTab
        value={{ ...defaultLocalSpeechSettings, inputEnabled: true }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: i18nService.t('voiceModelDownload') })).toBeTruthy();
  });

  it('configures an online provider without offering a local model download', async () => {
    const saveConfiguration = vi.fn().mockResolvedValue(undefined);
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        localSpeechModels: {
          list: vi.fn().mockResolvedValue({ supported: true, models: [] }),
          install: vi.fn(),
          onChanged: vi.fn().mockReturnValue(() => undefined),
        },
        onlineAsr: {
          getConfiguration: vi.fn().mockResolvedValue({
            available: true,
            provider: 'deepgram',
            selectedProvider: 'deepgram',
            baseUrl: 'ws://speech.internal:8000',
            credentialConfigured: true,
            providers: [
              {
                id: 'deepgram',
                label: 'Deepgram',
                configured: true,
                defaultModel: 'nova-3',
              },
            ],
          }),
          saveConfiguration,
        },
      },
    });

    render(
      <VoiceSettingsTab
        value={{
          ...defaultLocalSpeechSettings,
          inputEnabled: true,
          recognitionMode: 'online',
        }}
        onChange={vi.fn()}
      />,
    );

    expect(await screen.findByText(i18nService.t('voiceOnlineReady'))).toBeTruthy();
    expect(screen.getByText('deepgram')).toBeTruthy();
    const modelInput = screen.getByLabelText<HTMLInputElement>(i18nService.t('voiceOnlineModel'));
    expect(modelInput.value).toBe('');
    fireEvent.change(modelInput, { target: { value: 'nova-3' } });
    const apiKeyInput = screen.getByLabelText<HTMLInputElement>(i18nService.t('voiceOnlineApiKey'));
    expect(apiKeyInput.type).toBe('password');
    fireEvent.change(apiKeyInput, {
      target: { value: 'new-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18nService.t('voiceOnlineShowApiKey') }));
    expect(apiKeyInput.type).toBe('text');
    expect(
      screen.getByRole('button', { name: i18nService.t('voiceOnlineHideApiKey') }),
    ).toBeTruthy();
    dispatchEvent.mockClear();
    fireEvent.click(screen.getByRole('button', { name: i18nService.t('voiceOnlineSave') }));
    await vi.waitFor(() =>
      expect(saveConfiguration).toHaveBeenCalledWith({
        provider: 'deepgram',
        baseUrl: 'ws://speech.internal:8000',
        apiKey: 'new-key',
        model: 'nova-3',
      }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'config-updated' }));
    expect(screen.queryByRole('button', { name: i18nService.t('voiceModelDownload') })).toBeNull();
  });

  it('configures OpenAI-compatible online response reading', async () => {
    const saveConfiguration = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        localSpeechModels: {
          list: vi.fn().mockResolvedValue({ supported: true, models: [] }),
          install: vi.fn(),
          onChanged: vi.fn().mockReturnValue(() => undefined),
        },
        onlineTts: {
          getConfiguration: vi.fn().mockResolvedValue({
            available: false,
            selectedProvider: 'openai',
            credentialConfigured: false,
            providers: [
              {
                id: 'openai',
                label: 'OpenAI',
                configured: false,
                models: ['gpt-4o-mini-tts'],
                voices: ['coral'],
              },
            ],
          }),
          saveConfiguration,
        },
      },
    });

    render(
      <VoiceSettingsTab
        value={{
          ...defaultLocalSpeechSettings,
          outputEnabled: true,
          synthesisMode: 'online',
        }}
        onChange={vi.fn()}
      />,
    );

    expect(await screen.findByText(i18nService.t('voiceOnlineTtsUnavailable'))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(i18nService.t('voiceOnlineBaseUrl')), {
      target: { value: 'http://speech.internal:8000/v1' },
    });
    fireEvent.change(screen.getByLabelText(i18nService.t('voiceSynthesisModel')), {
      target: { value: 'internal-tts' },
    });
    fireEvent.change(screen.getByLabelText(i18nService.t('voiceSpeaker')), {
      target: { value: 'speaker-1' },
    });
    fireEvent.change(screen.getByLabelText(i18nService.t('voiceOnlineApiKey')), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18nService.t('voiceOnlineSave') }));

    await vi.waitFor(() =>
      expect(saveConfiguration).toHaveBeenCalledWith({
        provider: 'openai',
        baseUrl: 'http://speech.internal:8000/v1',
        apiKey: 'secret',
        model: 'internal-tts',
        voice: 'speaker-1',
      }),
    );
    expect(screen.queryByRole('button', { name: i18nService.t('voiceModelDownload') })).toBeNull();
  });
});
