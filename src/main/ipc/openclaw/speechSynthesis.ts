import { ipcMain } from 'electron';

import {
  SpeechSynthesisIpc,
  type SpeechSynthesisResult,
} from '../../../shared/speech/speechSynthesis';

const MAX_PREVIEW_TEXT_LENGTH = 500;

interface SpeechSynthesisHandlerDependencies {
  requestGateway: <T>(method: string, params?: unknown) => Promise<T>;
}
export function registerSpeechSynthesisHandlers({
  requestGateway,
}: SpeechSynthesisHandlerDependencies): void {
  ipcMain.handle(
    SpeechSynthesisIpc.Speak,
    async (_event, text: unknown): Promise<SpeechSynthesisResult> => {
      const normalizedText = typeof text === 'string' ? text.trim() : '';
      if (!normalizedText || normalizedText.length > MAX_PREVIEW_TEXT_LENGTH) {
        throw new Error('Invalid speech preview text.');
      }
      return requestGateway<SpeechSynthesisResult>('tts.speak', { text: normalizedText });
    },
  );
}
