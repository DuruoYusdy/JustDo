// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { configService } from '@/services/config';
import { i18nService } from '@/services/i18n';

import { LocalSpeechInputButton } from './LocalSpeechInputButton';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LocalSpeechInputButton', () => {
  it('renders the microphone only when local recognition assets are available', async () => {
    const currentConfig = configService.getConfig();
    vi.spyOn(configService, 'getConfig').mockReturnValue({
      ...currentConfig,
      voice: { ...currentConfig.voice, inputEnabled: true },
    });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        localAsr: {
          getStatus: vi.fn().mockResolvedValue({
            available: true,
            supported: true,
            modelId: 'sherpa-onnx-whisper-tiny',
          }),
        },
        localSpeechModels: {
          onChanged: vi.fn().mockReturnValue(() => undefined),
        },
      },
    });

    render(<LocalSpeechInputButton disabled={false} onTranscript={vi.fn()} />);

    expect(
      await screen.findByRole('button', { name: i18nService.t('localAsrStart') }),
    ).toBeTruthy();
  });

  it('stays hidden when the local recognition bundle is unavailable', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        localAsr: {
          getStatus: vi.fn().mockResolvedValue({
            available: false,
            supported: true,
            modelId: 'sherpa-onnx-whisper-tiny',
          }),
        },
        localSpeechModels: {
          onChanged: vi.fn().mockReturnValue(() => undefined),
        },
      },
    });

    const { container } = render(
      <LocalSpeechInputButton disabled={false} onTranscript={vi.fn()} />,
    );
    await vi.waitFor(() => expect(window.electron.localAsr.getStatus).toHaveBeenCalledOnce());
    expect(container.innerHTML).toBe('');
  });
});
