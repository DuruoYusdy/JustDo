import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { LOCAL_ASR_DEFAULT_MODEL_ID } from '../../shared/speech/localAsr';
import {
  buildLocalAsrModelArgs,
  getLocalAsrStatus,
  type LocalAsrAssetPaths,
  normalizeLocalAsrTranscript,
  parseSherpaTranscription,
} from './localAsrService';

const temporaryRoots: string[] = [];

function createPaths(): LocalAsrAssetPaths {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-local-asr-test-'));
  temporaryRoots.push(root);
  return {
    executablePath: path.join(root, 'runtime', 'bin', 'sherpa-onnx-offline.exe'),
    modelDir: path.join(root, LOCAL_ASR_DEFAULT_MODEL_ID),
    modelId: LOCAL_ASR_DEFAULT_MODEL_ID,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('local ASR service', () => {
  it('reports only a complete, pinned runtime as available', () => {
    const paths = createPaths();
    expect(getLocalAsrStatus(paths).available).toBe(false);

    fs.mkdirSync(path.dirname(paths.executablePath), { recursive: true });
    fs.mkdirSync(paths.modelDir, { recursive: true });
    fs.writeFileSync(paths.executablePath, 'runtime');
    for (const file of ['model.int8.onnx', 'tokens.txt']) {
      fs.writeFileSync(path.join(paths.modelDir, file), file);
    }
    expect(getLocalAsrStatus(paths)).toEqual({
      available: true,
      supported: true,
      modelId: LOCAL_ASR_DEFAULT_MODEL_ID,
    });
  });

  it('extracts the final JSON transcript from sherpa diagnostics', () => {
    const output = [
      'Creating recognizer ...',
      'Done!',
      '{"lang":"zh","text":"今天天气很好","tokens":[]}',
    ].join('\n');

    expect(parseSherpaTranscription(output)).toBe('今天天气很好');
  });

  it('normalizes explicit Mandarin transcripts to simplified Chinese', () => {
    const transcript = '今天天氣很好，我們測試語音識別。';

    expect(normalizeLocalAsrTranscript(transcript, 'zh')).toBe('今天天气很好，我们测试语音识别。');
    expect(normalizeLocalAsrTranscript(transcript, 'yue')).toBe(transcript);
    expect(normalizeLocalAsrTranscript(transcript, 'auto')).toBe(transcript);
  });

  it('uses multilingual short-audio arguments without forcing a language in auto mode', () => {
    const automatic = buildLocalAsrModelArgs(
      'sherpa-onnx-whisper-base',
      'auto',
      'C:\\models\\base',
    );
    const japanese = buildLocalAsrModelArgs('sherpa-onnx-whisper-base', 'ja', 'C:\\models\\base');

    expect(automatic).not.toContainEqual(expect.stringContaining('--whisper-language='));
    expect(automatic).toContain('--whisper-tail-paddings=300');
    expect(japanese).toContain('--whisper-language=jp');
    expect(() =>
      buildLocalAsrModelArgs('sherpa-onnx-whisper-base', 'yue', 'C:\\models\\base'),
    ).toThrow('does not support Cantonese');
  });

  it('passes auto language and inverse text normalization to SenseVoice', () => {
    expect(
      buildLocalAsrModelArgs(
        'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
        'auto',
        'C:\\models\\sensevoice',
      ),
    ).toEqual(
      expect.arrayContaining(['--sense-voice-language=auto', '--sense-voice-use-itn=true']),
    );
  });
});
