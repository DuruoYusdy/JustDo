import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isLocalSpeechRuntimeReady,
  LOCAL_SPEECH_RUNTIME_MARKER,
  resolveLocalSpeechModelDir,
} from './localSpeechPaths';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('local speech paths', () => {
  it('requires the pinned runtime marker and both speech executables', () => {
    const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-speech-resources-'));
    temporaryRoots.push(resourcesPath);
    const root = path.join(resourcesPath, 'local-tts', 'win-x64');
    const bin = path.join(root, 'runtime', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'sherpa-onnx-offline.exe'), 'asr');
    fs.writeFileSync(path.join(bin, 'sherpa-onnx-offline-tts.exe'), 'tts');

    expect(isLocalSpeechRuntimeReady({ packaged: true, resourcesPath })).toBe(false);

    fs.writeFileSync(
      path.join(root, '.justdo-local-speech-runtime-version'),
      LOCAL_SPEECH_RUNTIME_MARKER,
    );
    expect(isLocalSpeechRuntimeReady({ packaged: true, resourcesPath })).toBe(true);
  });

  it('resolves packaged models from user data instead of application resources', () => {
    const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-speech-resources-'));
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-speech-user-data-'));
    temporaryRoots.push(resourcesPath, userDataPath);

    expect(
      resolveLocalSpeechModelDir('model-a', {
        packaged: true,
        resourcesPath,
        userDataPath,
      }),
    ).toBe(path.join(userDataPath, 'local-speech-models', 'model-a'));
  });
});
