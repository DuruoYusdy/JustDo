export const LocalSpeechModelIpc = {
  List: 'local-speech-model:list',
  Install: 'local-speech-model:install',
  Remove: 'local-speech-model:remove',
  Changed: 'local-speech-model:changed',
} as const;

export const LocalSpeechModelKind = {
  Asr: 'asr',
  Tts: 'tts',
} as const;

export type LocalSpeechModelKind = (typeof LocalSpeechModelKind)[keyof typeof LocalSpeechModelKind];

export type LocalSpeechModelPhase =
  'not-installed' | 'downloading' | 'installing' | 'ready' | 'error';

export interface LocalSpeechModelStatus {
  id: string;
  kind: LocalSpeechModelKind;
  phase: LocalSpeechModelPhase;
  installed: boolean;
  downloadBytes?: number;
  downloadBytesExact?: boolean;
  downloadPercent?: number;
  error?: string;
}

export interface LocalSpeechModelListResult {
  supported: boolean;
  models: LocalSpeechModelStatus[];
}

export interface LocalSpeechModelInstallResult {
  success: boolean;
  status: LocalSpeechModelStatus;
}
