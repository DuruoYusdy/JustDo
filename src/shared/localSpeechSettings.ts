import { LOCAL_ASR_MODEL_ID, LOCAL_ASR_MODEL_IDS, type LocalAsrModelId } from './localAsr';
import {
  LOCAL_TTS_DEFAULT_VOICE_ID,
  LOCAL_TTS_MODEL_ID,
  LOCAL_TTS_MODEL_IDS,
  type LocalTtsModelId,
} from './localTts';

export const LOCAL_SPEECH_MIN_RECORDING_SECONDS = 5;
export const LOCAL_SPEECH_MAX_RECORDING_SECONDS = 120;
export const LOCAL_SPEECH_MIN_MEETING_SEGMENT_SECONDS = 15;
export const LOCAL_SPEECH_MAX_MEETING_SEGMENT_SECONDS = 60;
export const LOCAL_SPEECH_MIN_THREADS = 1;
export const LOCAL_SPEECH_MAX_THREADS = 8;
export const LOCAL_SPEECH_MIN_RATE = 0.5;
export const LOCAL_SPEECH_MAX_RATE = 2;

export type LocalSpeechInputLanguage = 'app' | 'zh' | 'en';
export type LocalSpeechInputSource = 'microphone' | 'system' | 'microphone-system' | 'file';

export interface LocalSpeechSettings {
  inputEnabled: boolean;
  asrModelId: LocalAsrModelId;
  inputSource: LocalSpeechInputSource;
  inputDeviceId: string;
  inputLanguage: LocalSpeechInputLanguage;
  maxRecordingSeconds: number;
  meetingMode: boolean;
  meetingSegmentSeconds: number;
  recognitionThreads: number;
  outputEnabled: boolean;
  ttsModelId: LocalTtsModelId;
  voiceId: number;
  speechRate: number;
  synthesisThreads: number;
}

export const defaultLocalSpeechSettings: LocalSpeechSettings = {
  inputEnabled: false,
  asrModelId: LOCAL_ASR_MODEL_ID,
  inputSource: 'microphone',
  inputDeviceId: '',
  inputLanguage: 'app',
  maxRecordingSeconds: 60,
  meetingMode: false,
  meetingSegmentSeconds: 30,
  recognitionThreads: 2,
  outputEnabled: false,
  ttsModelId: LOCAL_TTS_MODEL_ID,
  voiceId: LOCAL_TTS_DEFAULT_VOICE_ID,
  speechRate: 1,
  synthesisThreads: 2,
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
};

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number =>
  Math.round(clampNumber(value, fallback, min, max));

export const normalizeLocalSpeechSettings = (value: unknown): LocalSpeechSettings => {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const inputLanguage =
    candidate.inputLanguage === 'zh' ||
    candidate.inputLanguage === 'en' ||
    candidate.inputLanguage === 'app'
      ? candidate.inputLanguage
      : defaultLocalSpeechSettings.inputLanguage;
  const inputSource =
    candidate.inputSource === 'system' ||
    candidate.inputSource === 'microphone-system' ||
    candidate.inputSource === 'file' ||
    candidate.inputSource === 'microphone'
      ? candidate.inputSource
      : defaultLocalSpeechSettings.inputSource;
  const asrModelId = LOCAL_ASR_MODEL_IDS.includes(candidate.asrModelId as LocalAsrModelId)
    ? (candidate.asrModelId as LocalAsrModelId)
    : defaultLocalSpeechSettings.asrModelId;
  const ttsModelId = LOCAL_TTS_MODEL_IDS.includes(candidate.ttsModelId as LocalTtsModelId)
    ? (candidate.ttsModelId as LocalTtsModelId)
    : defaultLocalSpeechSettings.ttsModelId;
  const maximumVoiceId =
    ttsModelId === 'vits-icefall-zh-aishell3'
      ? 173
      : ttsModelId === LOCAL_TTS_MODEL_ID
        ? 102
        : 0;

  return {
    inputEnabled:
      typeof candidate.inputEnabled === 'boolean'
        ? candidate.inputEnabled
        : defaultLocalSpeechSettings.inputEnabled,
    asrModelId,
    inputSource,
    inputDeviceId:
      typeof candidate.inputDeviceId === 'string' ? candidate.inputDeviceId : '',
    inputLanguage,
    maxRecordingSeconds: clampInteger(
      candidate.maxRecordingSeconds,
      defaultLocalSpeechSettings.maxRecordingSeconds,
      LOCAL_SPEECH_MIN_RECORDING_SECONDS,
      LOCAL_SPEECH_MAX_RECORDING_SECONDS,
    ),
    meetingMode:
      typeof candidate.meetingMode === 'boolean'
        ? candidate.meetingMode
        : defaultLocalSpeechSettings.meetingMode,
    meetingSegmentSeconds: clampInteger(
      candidate.meetingSegmentSeconds,
      defaultLocalSpeechSettings.meetingSegmentSeconds,
      LOCAL_SPEECH_MIN_MEETING_SEGMENT_SECONDS,
      LOCAL_SPEECH_MAX_MEETING_SEGMENT_SECONDS,
    ),
    recognitionThreads: clampInteger(
      candidate.recognitionThreads,
      defaultLocalSpeechSettings.recognitionThreads,
      LOCAL_SPEECH_MIN_THREADS,
      LOCAL_SPEECH_MAX_THREADS,
    ),
    outputEnabled:
      typeof candidate.outputEnabled === 'boolean'
        ? candidate.outputEnabled
        : defaultLocalSpeechSettings.outputEnabled,
    ttsModelId,
    voiceId: clampInteger(
      candidate.voiceId,
      ttsModelId === LOCAL_TTS_MODEL_ID ? defaultLocalSpeechSettings.voiceId : 0,
      0,
      maximumVoiceId,
    ),
    speechRate: clampNumber(
      candidate.speechRate,
      defaultLocalSpeechSettings.speechRate,
      LOCAL_SPEECH_MIN_RATE,
      LOCAL_SPEECH_MAX_RATE,
    ),
    synthesisThreads: clampInteger(
      candidate.synthesisThreads,
      defaultLocalSpeechSettings.synthesisThreads,
      LOCAL_SPEECH_MIN_THREADS,
      LOCAL_SPEECH_MAX_THREADS,
    ),
  };
};

export const resolveLocalSpeechInputLanguage = (
  setting: LocalSpeechInputLanguage,
  appLanguage: 'zh' | 'en',
): 'zh' | 'en' => (setting === 'app' ? appLanguage : setting);
