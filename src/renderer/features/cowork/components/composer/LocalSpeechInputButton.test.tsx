// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
            modelId: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
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
            modelId: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
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

  it('writes one capture failure summary to the main log', async () => {
    const currentConfig = configService.getConfig();
    vi.spyOn(configService, 'getConfig').mockReturnValue({
      ...currentConfig,
      voice: {
        ...currentConfig.voice,
        inputEnabled: true,
        inputSource: 'system',
      },
    });
    const debug = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: vi
          .fn()
          .mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')),
      },
    });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        localAsr: {
          getStatus: vi.fn().mockResolvedValue({
            available: true,
            supported: true,
            modelId: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
          }),
        },
        localSpeechModels: {
          onChanged: vi.fn().mockReturnValue(() => undefined),
        },
        mediaCapture: { armSystemAudio: vi.fn().mockResolvedValue(undefined) },
        log: { debug },
      },
    });

    render(<LocalSpeechInputButton disabled={false} onTranscript={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: i18nService.t('localAsrStart') }));

    await vi.waitFor(() =>
      expect(debug).toHaveBeenCalledWith(
        '[LocalSpeechInput] Audio capture failed.',
        expect.objectContaining({
          source: 'system',
          errorName: 'NotAllowedError',
          errorMessage: 'Permission denied',
        }),
      ),
    );
    expect(debug).toHaveBeenCalledOnce();
  });

  it('releases a late permission result after the composer becomes disabled', async () => {
    const currentConfig = configService.getConfig();
    vi.spyOn(configService, 'getConfig').mockReturnValue({
      ...currentConfig,
      voice: { ...currentConfig.voice, inputEnabled: true, inputSource: 'microphone' },
    });
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>(resolve => {
          resolveStream = resolve;
        }),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        localAsr: {
          getStatus: vi.fn().mockResolvedValue({
            available: true,
            supported: true,
            modelId: 'sherpa-onnx-whisper-base',
          }),
        },
        localSpeechModels: {
          onChanged: vi.fn().mockReturnValue(() => undefined),
        },
      },
    });
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;

    const { rerender } = render(<LocalSpeechInputButton disabled={false} onTranscript={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: i18nService.t('localAsrStart') }));
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    rerender(<LocalSpeechInputButton disabled onTranscript={vi.fn()} />);
    resolveStream?.(stream);

    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });

  it('streams microphone audio through an OpenClaw transcription Talk session', async () => {
    const currentConfig = configService.getConfig();
    vi.spyOn(configService, 'getConfig').mockReturnValue({
      ...currentConfig,
      voice: {
        ...currentConfig.voice,
        inputEnabled: true,
        recognitionMode: 'online',
        inputSource: 'microphone',
      },
    });
    const audioTrack = {
      readyState: 'live',
      addEventListener: vi.fn(),
      stop: vi.fn(),
    };
    const stream = {
      active: true,
      getTracks: () => [audioTrack],
      getAudioTracks: () => [audioTrack],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    let processAudio: ((event: AudioProcessingEvent) => void) | null = null;
    class FakeAudioContext {
      sampleRate = 8000;
      state = 'running';
      destination = {};
      resume = vi.fn().mockResolvedValue(undefined);
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
      createScriptProcessor = () => ({
        get onaudioprocess() {
          return processAudio;
        },
        set onaudioprocess(handler: ((event: AudioProcessingEvent) => void) | null) {
          processAudio = handler;
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() });
      close = vi.fn().mockResolvedValue(undefined);
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    let emitOnlineEvent: ((event: import('@shared/speech/onlineAsr').OnlineAsrEvent) => void) | undefined;
    const appendAudio = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        localSpeechModels: { onChanged: vi.fn().mockReturnValue(() => undefined) },
        onlineAsr: {
          getStatus: vi.fn().mockResolvedValue({ available: true, provider: 'deepgram' }),
          start: vi.fn().mockResolvedValue({
            sessionId: 'talk-1',
            transcriptionSessionId: 'transcription-1',
            provider: 'deepgram',
            inputEncoding: 'g711_ulaw',
            inputSampleRateHz: 8000,
          }),
          appendAudio,
          close,
          onEvent: vi.fn((callback: typeof emitOnlineEvent) => {
            emitOnlineEvent = callback;
            return () => undefined;
          }),
        },
      },
    });
    const onTranscript = vi.fn();

    render(<LocalSpeechInputButton disabled={false} onTranscript={onTranscript} />);
    fireEvent.click(await screen.findByRole('button', { name: i18nService.t('localAsrStart') }));
    await screen.findByRole('button', { name: i18nService.t('localAsrStop') });
    const audioHandler = processAudio as ((event: AudioProcessingEvent) => void) | null;
    audioHandler?.({
      inputBuffer: { getChannelData: () => new Float32Array([0, 0.5, -0.5]) },
    } as unknown as AudioProcessingEvent);
    await vi.waitFor(() => expect(appendAudio).toHaveBeenCalledWith('talk-1', expect.any(String)));
    fireEvent.click(screen.getByRole('button', { name: i18nService.t('localAsrStop') }));

    await vi.waitFor(() => expect(close).toHaveBeenCalledWith('talk-1'));
    emitOnlineEvent?.({
      transcriptionSessionId: 'transcription-1',
      type: 'transcript',
      text: '在线识别结果',
      final: true,
    });
    emitOnlineEvent?.({ transcriptionSessionId: 'transcription-1', type: 'close' });
    expect(onTranscript).toHaveBeenCalledWith('在线识别结果');
  });
});
