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
                id: 'sherpa-onnx-whisper-tiny',
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
    fireEvent.click(
      screen.getByRole('switch', { name: i18nService.t('voiceInputEnabled') }),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...defaultLocalSpeechSettings,
      inputEnabled: true,
    });
    expect(
      screen.getByRole('switch', { name: i18nService.t('voiceOutputEnabled') }),
    ).toBeTruthy();
  });

  it('starts the selected model download when voice input is enabled', async () => {
    const install = vi.fn().mockResolvedValue({
      success: true,
      status: {
        id: 'sherpa-onnx-whisper-tiny',
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
                id: 'sherpa-onnx-whisper-tiny',
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

    render(<VoiceSettingsTab value={defaultLocalSpeechSettings} onChange={vi.fn()} />);
    await screen.findAllByText(i18nService.t('voiceModelNotInstalled'));
    fireEvent.click(
      screen.getByRole('switch', { name: i18nService.t('voiceInputEnabled') }),
    );

    expect(install).toHaveBeenCalledWith('asr', 'sherpa-onnx-whisper-tiny');
  });
});
