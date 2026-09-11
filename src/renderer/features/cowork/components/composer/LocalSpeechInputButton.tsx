import { DocumentArrowUpIcon, MicrophoneIcon, StopIcon } from '@heroicons/react/24/outline';
import { LocalSpeechModelKind } from '@shared/localSpeechModels';
import {
  type LocalSpeechInputSource,
  type LocalSpeechSettings,
  normalizeLocalSpeechSettings,
  resolveLocalSpeechInputLanguage,
} from '@shared/localSpeechSettings';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  recordedAudioToWav,
  recordedAudioToWavSegments,
} from '@/features/cowork/components/composer/localAudioCapture';
import { configService } from '@/services/config';
import { i18nService } from '@/services/i18n';

type RecordingState = 'idle' | 'recording' | 'transcribing';
type CaptureTrack = { source: 'microphone' | 'system'; stream: MediaStream };

interface LocalSpeechInputButtonProps {
  disabled: boolean;
  onTranscript: (text: string) => void;
}

const showToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

const formatElapsed = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const getMicrophoneStream = (deviceId: string): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  });

const getSystemStream = async (): Promise<MediaStream> => {
  const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  display.getVideoTracks().forEach(track => track.stop());
  const audioTracks = display.getAudioTracks();
  if (audioTracks.length === 0) {
    throw new DOMException('System audio is unavailable.', 'NotFoundError');
  }
  return new MediaStream(audioTracks);
};

const openCaptureTracks = async (
  source: LocalSpeechInputSource,
  deviceId: string,
): Promise<CaptureTrack[]> => {
  if (source === 'microphone') {
    return [{ source: 'microphone', stream: await getMicrophoneStream(deviceId) }];
  }
  if (source === 'system') return [{ source: 'system', stream: await getSystemStream() }];
  if (source !== 'microphone-system') return [];
  // Request loopback first so Chromium still sees the original button-click gesture.
  const system = await getSystemStream();
  try {
    return [
      { source: 'microphone', stream: await getMicrophoneStream(deviceId) },
      { source: 'system', stream: system },
    ];
  } catch (error) {
    system.getTracks().forEach(track => track.stop());
    throw error;
  }
};

export function LocalSpeechInputButton({
  disabled,
  onTranscript,
}: LocalSpeechInputButtonProps): React.ReactElement | null {
  const [available, setAvailable] = useState(false);
  const [settings, setSettings] = useState<LocalSpeechSettings>(() =>
    normalizeLocalSpeechSettings(configService.getConfig().voice),
  );
  const [state, setState] = useState<RecordingState>('idle');
  const tracksRef = useRef<CaptureTrack[]>([]);
  const recordersRef = useRef<MediaRecorder[]>([]);
  const recorderStopsRef = useRef(new Map<MediaRecorder, Promise<void>>());
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const activeRef = useRef(false);
  const startedAtRef = useRef(0);
  const transcriptQueueRef = useRef<Promise<void>>(Promise.resolve());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);

  const releaseCapture = useCallback(() => {
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current = [];
    tracksRef.current.forEach(({ stream }) => stream.getTracks().forEach(track => track.stop()));
    tracksRef.current = [];
    recordersRef.current = [];
    recorderStopsRef.current.clear();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const refresh = () => {
      const nextSettings = normalizeLocalSpeechSettings(configService.getConfig().voice);
      setSettings(nextSettings);
      void window.electron.localAsr
        .getStatus(nextSettings.asrModelId)
        .then(status => mountedRef.current && setAvailable(status.available))
        .catch(() => mountedRef.current && setAvailable(false));
    };
    refresh();
    window.addEventListener('config-updated', refresh);
    const unsubscribeModels = window.electron.localSpeechModels.onChanged(status => {
      if (status.kind === LocalSpeechModelKind.Asr) refresh();
    });
    return () => {
      mountedRef.current = false;
      activeRef.current = false;
      window.removeEventListener('config-updated', refresh);
      unsubscribeModels();
      recordersRef.current.forEach(recorder => {
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      });
      releaseCapture();
    };
  }, [releaseCapture]);

  const transcribeWav = useCallback(
    async (wav: Uint8Array, source?: CaptureTrack['source'], elapsed = 0) => {
      const result = await window.electron.localAsr.transcribe(wav, {
        modelId: settings.asrModelId,
        language: resolveLocalSpeechInputLanguage(settings.inputLanguage, i18nService.getLanguage()),
        numThreads: settings.recognitionThreads,
      });
      if (!result.success || !result.text?.trim()) return;
      const text = result.text.trim();
      if (!settings.meetingMode || !source) {
        onTranscript(text);
        return;
      }
      const sourceLabel = i18nService.t(
        source === 'microphone' ? 'localAsrSourceMicrophoneShort' : 'localAsrSourceSystemShort',
      );
      onTranscript(`[${formatElapsed(elapsed)}] ${sourceLabel}: ${text}`);
    },
    [onTranscript, settings],
  );

  const enqueueTranscription = useCallback(
    (blob: Blob, source: CaptureTrack['source'], elapsed: number) => {
      transcriptQueueRef.current = transcriptQueueRef.current
        .then(async () => transcribeWav(await recordedAudioToWav(blob), source, elapsed))
        .catch(() => showToast(i18nService.t('localAsrFailed')));
    },
    [transcribeWav],
  );

  const startRecorder = useCallback(
    (track: CaptureTrack) => {
      if (!activeRef.current) return;
      const recorder = new MediaRecorder(track.stream);
      const chunks: Blob[] = [];
      const segmentStartedAt = Date.now() - startedAtRef.current;
      let markStopped: () => void = () => undefined;
      const stopped = new Promise<void>(resolve => {
        markStopped = resolve;
      });
      recorderStopsRef.current.set(recorder, stopped);
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (chunks.length > 0) {
          enqueueTranscription(new Blob(chunks), track.source, segmentStartedAt);
        }
        recordersRef.current = recordersRef.current.filter(candidate => candidate !== recorder);
        recorderStopsRef.current.delete(recorder);
        markStopped();
        if (activeRef.current && settings.meetingMode) startRecorder(track);
      };
      recordersRef.current.push(recorder);
      recorder.start();
      const seconds = settings.meetingMode
        ? settings.meetingSegmentSeconds
        : settings.maxRecordingSeconds;
      if (settings.meetingMode) {
        timersRef.current.push(
          setTimeout(() => {
            if (recorder.state === 'recording') recorder.stop();
          }, seconds * 1_000),
        );
      }
    },
    [enqueueTranscription, settings.maxRecordingSeconds, settings.meetingMode, settings.meetingSegmentSeconds],
  );

  const stopRecording = useCallback(() => {
    activeRef.current = false;
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current = [];
    const recorders = [...recordersRef.current];
    const stopped = recorders.map(
      recorder => recorderStopsRef.current.get(recorder) ?? Promise.resolve(),
    );
    recorders.forEach(recorder => {
      if (recorder.state === 'recording') recorder.stop();
    });
    setState('transcribing');
    void Promise.all(stopped).then(() =>
      transcriptQueueRef.current.finally(() => {
        releaseCapture();
        if (mountedRef.current) setState('idle');
      }),
    );
  }, [releaseCapture]);

  const startRecording = useCallback(async () => {
    try {
      const tracks = await openCaptureTracks(settings.inputSource, settings.inputDeviceId);
      if (!mountedRef.current) {
        tracks.forEach(({ stream }) => stream.getTracks().forEach(track => track.stop()));
        return;
      }
      tracksRef.current = tracks;
      activeRef.current = true;
      startedAtRef.current = Date.now();
      setState('recording');
      tracks.forEach(startRecorder);
      if (!settings.meetingMode) {
        timersRef.current.push(
          setTimeout(stopRecording, settings.maxRecordingSeconds * 1_000),
        );
      }
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      showToast(i18nService.t(denied ? 'localAsrPermissionDenied' : 'localAsrFailed'));
      releaseCapture();
      setState('idle');
    }
  }, [
    releaseCapture,
    settings.inputDeviceId,
    settings.inputSource,
    settings.maxRecordingSeconds,
    settings.meetingMode,
    startRecorder,
    stopRecording,
  ]);

  const transcribeFile = useCallback(
    async (file: File) => {
      setState('transcribing');
      try {
        const segments = await recordedAudioToWavSegments(file, settings.meetingSegmentSeconds);
        for (let index = 0; index < segments.length; index += 1) {
          await transcribeWav(
            segments[index],
            'system',
            index * settings.meetingSegmentSeconds * 1_000,
          );
        }
      } catch {
        showToast(i18nService.t('localAsrFailed'));
      } finally {
        if (mountedRef.current) setState('idle');
      }
    },
    [settings.meetingSegmentSeconds, transcribeWav],
  );

  useEffect(() => {
    if (disabled && state === 'recording') stopRecording();
  }, [disabled, state, stopRecording]);

  if (!available || !settings.inputEnabled) return null;
  const recording = state === 'recording';
  const fileSource = settings.inputSource === 'file';
  const title = i18nService.t(
    state === 'transcribing'
      ? 'localAsrTranscribing'
      : recording
        ? 'localAsrStop'
        : fileSource
          ? 'localAsrImportFile'
          : settings.meetingMode
            ? 'localAsrStartMeeting'
            : 'localAsrStart',
  );
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void transcribeFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => {
          if (recording) stopRecording();
          else if (fileSource) fileInputRef.current?.click();
          else void startRecording();
        }}
        className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
          recording
            ? 'bg-red-500/15 text-red-500 after:absolute after:inset-0 after:animate-ping after:rounded-lg after:border after:border-red-500/40'
            : 'text-secondary hover:bg-surface-raised hover:text-foreground'
        }`}
        title={title}
        aria-label={title}
        aria-pressed={recording}
        aria-busy={state === 'transcribing'}
        disabled={disabled || state === 'transcribing'}
      >
        {state === 'transcribing' ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : recording ? (
          <StopIcon className="h-4 w-4" />
        ) : fileSource ? (
          <DocumentArrowUpIcon className="h-4 w-4" />
        ) : (
          <MicrophoneIcon className="h-4 w-4" />
        )}
      </button>
    </>
  );
}
