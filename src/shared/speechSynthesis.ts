import type { LocalTtsSpeakResult } from './localTts';

export const SpeechSynthesisIpc = {
  Speak: 'speech-synthesis:speak',
} as const;

export type SpeechSynthesisResult = LocalTtsSpeakResult;
