export const LocalAsrIpc = {
  GetStatus: 'local-asr:status',
  Transcribe: 'local-asr:transcribe',
} as const;

export const LOCAL_ASR_MODEL_ID = 'sherpa-onnx-whisper-tiny';
export const LOCAL_ASR_MODEL_IDS = [
  LOCAL_ASR_MODEL_ID,
  'sherpa-onnx-whisper-base',
  'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
] as const;
export type LocalAsrModelId = (typeof LOCAL_ASR_MODEL_IDS)[number];
export const LOCAL_ASR_MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export interface LocalAsrStatus {
  available: boolean;
  supported: boolean;
  modelId: LocalAsrModelId;
}

export interface LocalAsrTranscribeResult {
  success: boolean;
  text?: string;
  error?: string;
}

export type LocalAsrLanguage = 'zh' | 'en';

export interface LocalAsrTranscribeOptions {
  modelId: LocalAsrModelId;
  language: LocalAsrLanguage;
  numThreads: number;
}
