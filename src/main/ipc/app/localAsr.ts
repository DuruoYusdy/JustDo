import { ipcMain } from 'electron';

import {
  LOCAL_ASR_MODEL_ID,
  LocalAsrIpc,
  type LocalAsrTranscribeOptions,
  type LocalAsrTranscribeResult,
} from '../../../shared/localAsr';
import { normalizeLocalSpeechSettings } from '../../../shared/localSpeechSettings';
import {
  getLocalAsrStatus,
  isLocalAsrModelId,
  transcribeLocalAudio,
} from '../../speech/localAsrService';

export function registerLocalAsrHandlers(): void {
  ipcMain.handle(LocalAsrIpc.GetStatus, (_event, modelId: unknown) =>
    getLocalAsrStatus(isLocalAsrModelId(modelId) ? modelId : LOCAL_ASR_MODEL_ID),
  );
  ipcMain.handle(
    LocalAsrIpc.Transcribe,
    async (_event, audio: unknown, options: unknown): Promise<LocalAsrTranscribeResult> => {
      const request = options as Partial<LocalAsrTranscribeOptions> | null;
      if (
        !(audio instanceof Uint8Array) ||
        !request ||
        !isLocalAsrModelId(request.modelId) ||
        (request.language !== 'zh' && request.language !== 'en')
      ) {
        return { success: false, error: 'Invalid local transcription request.' };
      }
      try {
        const settings = normalizeLocalSpeechSettings({
          recognitionThreads: request.numThreads,
        });
        return {
          success: true,
          text: await transcribeLocalAudio(
            audio,
            request.modelId,
            request.language,
            settings.recognitionThreads,
          ),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
