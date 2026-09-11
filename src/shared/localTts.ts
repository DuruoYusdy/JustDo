export const LocalTtsIpc = {
  GetStatus: 'local-tts:status',
} as const;

export const LOCAL_TTS_PROVIDER_ID = 'tts-local-cli';
export const LOCAL_TTS_MODEL_ID = 'kokoro-int8-multi-lang-v1_1';
export const LOCAL_TTS_MODEL_IDS = [
  LOCAL_TTS_MODEL_ID,
  'vits-icefall-zh-aishell3',
  'vits-piper-en_US-lessac-medium-int8',
] as const;
export type LocalTtsModelId = (typeof LOCAL_TTS_MODEL_IDS)[number];
export const LOCAL_TTS_RUNTIME_VERSION = '1.13.7';
export const LOCAL_TTS_DEFAULT_VOICE_ID = 3;

export interface LocalTtsStatus {
  available: boolean;
  supported: boolean;
  modelId: LocalTtsModelId;
}

export interface LocalTtsSpeakResult {
  audioBase64: string;
  provider: string;
  outputFormat?: string;
  mimeType?: string;
  fileExtension?: string;
}
