import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { LOCAL_ASR_MODEL_ID } from '../../shared/localAsr';
import {
  getLocalAsrStatus,
  type LocalAsrAssetPaths,
  parseSherpaTranscription,
} from './localAsrService';

const temporaryRoots: string[] = [];

function createPaths(): LocalAsrAssetPaths {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-local-asr-test-'));
  temporaryRoots.push(root);
  return {
    executablePath: path.join(root, 'runtime', 'bin', 'sherpa-onnx-offline.exe'),
    modelDir: path.join(root, LOCAL_ASR_MODEL_ID),
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
    for (const file of ['tiny-encoder.int8.onnx', 'tiny-decoder.int8.onnx', 'tiny-tokens.txt']) {
      fs.writeFileSync(path.join(paths.modelDir, file), file);
    }
    expect(getLocalAsrStatus(paths)).toEqual({
      available: true,
      supported: true,
      modelId: LOCAL_ASR_MODEL_ID,
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
});
