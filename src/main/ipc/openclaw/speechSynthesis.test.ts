import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: never[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { SpeechSynthesisIpc } from '../../../shared/speech/speechSynthesis';
import { registerSpeechSynthesisHandlers } from './speechSynthesis';

describe('speech synthesis IPC', () => {
  const requestGateway = vi.fn();

  beforeEach(() => {
    handlers.clear();
    requestGateway.mockReset();
    registerSpeechSynthesisHandlers({ requestGateway });
  });

  it('synthesizes trimmed preview text through the configured Gateway provider', async () => {
    const result = { audioBase64: 'YXVkaW8=', provider: 'tts-local-cli' };
    requestGateway.mockResolvedValue(result);

    await expect(handlers.get(SpeechSynthesisIpc.Speak)?.({}, '  你好，欢迎使用。  ')).resolves.toBe(
      result,
    );
    expect(requestGateway).toHaveBeenCalledWith('tts.speak', { text: '你好，欢迎使用。' });
  });

  it('rejects empty and oversized preview text', async () => {
    const speak = handlers.get(SpeechSynthesisIpc.Speak);

    await expect(speak?.({}, '   ')).rejects.toThrow('Invalid speech preview text.');
    await expect(speak?.({}, 'a'.repeat(501))).rejects.toThrow('Invalid speech preview text.');
    expect(requestGateway).not.toHaveBeenCalled();
  });
});
