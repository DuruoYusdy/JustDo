import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import {
  isLocalAsrLanguageSupported,
  LOCAL_ASR_DEFAULT_MODEL_ID,
  LOCAL_ASR_MAX_AUDIO_BYTES,
  LOCAL_ASR_MODEL_IDS,
  type LocalAsrLanguage,
  type LocalAsrModelId,
  type LocalAsrStatus,
} from '../../shared/localAsr';
import {
  isLocalSpeechRuntimeReady,
  type LocalSpeechPathOptions,
  resolveLocalSpeechModelDir,
  resolveLocalSpeechRuntimeDir,
} from './localSpeechPaths';

const execFileAsync = promisify(execFile);
const TRANSCRIPTION_TIMEOUT_MS = 120_000;

export interface LocalAsrAssetPaths {
  executablePath: string;
  modelDir: string;
  modelId: LocalAsrModelId;
}

const ASR_MODEL_FILES: Record<LocalAsrModelId, string[]> = {
  'sherpa-onnx-whisper-base': [
    'base-encoder.int8.onnx',
    'base-decoder.int8.onnx',
    'base-tokens.txt',
  ],
  'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09': ['model.int8.onnx', 'tokens.txt'],
};

const isLocalAsrModelId = (value: unknown): value is LocalAsrModelId =>
  LOCAL_ASR_MODEL_IDS.includes(value as LocalAsrModelId);

export function resolveLocalAsrAssetPaths(
  modelId: LocalAsrModelId = LOCAL_ASR_DEFAULT_MODEL_ID,
  options?: LocalSpeechPathOptions,
): LocalAsrAssetPaths | null {
  if (!isLocalSpeechRuntimeReady(options)) return null;
  const runtimeDir = resolveLocalSpeechRuntimeDir(options);
  const modelDir = resolveLocalSpeechModelDir(modelId, options);
  if (!runtimeDir || !modelDir) return null;
  return {
    executablePath: path.join(runtimeDir, 'bin', 'sherpa-onnx-offline.exe'),
    modelDir,
    modelId,
  };
}

export function getLocalAsrStatus(
  modelIdOrPaths: LocalAsrModelId | LocalAsrAssetPaths = LOCAL_ASR_DEFAULT_MODEL_ID,
  suppliedPaths?: LocalAsrAssetPaths | null,
): LocalAsrStatus {
  const modelId =
    typeof modelIdOrPaths === 'string'
      ? modelIdOrPaths
      : (modelIdOrPaths.modelId ?? LOCAL_ASR_DEFAULT_MODEL_ID);
  const paths =
    typeof modelIdOrPaths === 'string'
      ? (suppliedPaths ?? resolveLocalAsrAssetPaths(modelId))
      : modelIdOrPaths;
  let available = false;
  try {
    available = Boolean(
      paths &&
      fs.existsSync(paths.executablePath) &&
      ASR_MODEL_FILES[modelId].every(file => fs.existsSync(path.join(paths.modelDir, file))),
    );
  } catch {
    available = false;
  }
  return { available, supported: paths !== null, modelId };
}

export async function transcribeLocalAudio(
  audio: Uint8Array,
  modelId: LocalAsrModelId,
  language: LocalAsrLanguage,
  numThreads = 2,
  paths = resolveLocalAsrAssetPaths(modelId),
): Promise<string> {
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
    throw new Error('Audio is empty.');
  }
  if (audio.byteLength > LOCAL_ASR_MAX_AUDIO_BYTES) {
    throw new Error('Audio exceeds the local transcription size limit.');
  }
  if (
    audio.byteLength < 44 ||
    Buffer.from(audio.subarray(0, 4)).toString('ascii') !== 'RIFF' ||
    Buffer.from(audio.subarray(8, 12)).toString('ascii') !== 'WAVE'
  ) {
    throw new Error('Audio must be a WAV recording.');
  }
  if (!paths || !getLocalAsrStatus(modelId, paths).available) {
    throw new Error('Local speech recognition is unavailable.');
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-local-asr-'));
  const audioPath = path.join(temporaryRoot, 'recording.wav');
  try {
    fs.writeFileSync(audioPath, audio);
    const modelArgs = buildLocalAsrModelArgs(modelId, language, paths.modelDir);
    const { stdout } = await execFileAsync(
      paths.executablePath,
      [...modelArgs, `--num-threads=${numThreads}`, audioPath],
      { windowsHide: true, timeout: TRANSCRIPTION_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    const text = parseSherpaTranscription(stdout);
    if (!text) throw new Error('No speech was recognized.');
    return text;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export { isLocalAsrModelId };

export function buildLocalAsrModelArgs(
  modelId: LocalAsrModelId,
  language: LocalAsrLanguage,
  modelDir: string,
): string[] {
  if (!isLocalAsrLanguageSupported(modelId, language)) {
    throw new Error('The selected speech recognition model does not support Cantonese.');
  }
  if (modelId.includes('sense-voice')) {
    return [
      `--tokens=${path.join(modelDir, 'tokens.txt')}`,
      `--sense-voice-model=${path.join(modelDir, 'model.int8.onnx')}`,
      `--sense-voice-language=${language}`,
      '--sense-voice-use-itn=true',
    ];
  }

  return [
    `--tokens=${path.join(modelDir, 'base-tokens.txt')}`,
    `--whisper-encoder=${path.join(modelDir, 'base-encoder.int8.onnx')}`,
    `--whisper-decoder=${path.join(modelDir, 'base-decoder.int8.onnx')}`,
    ...(language === 'auto' ? [] : [`--whisper-language=${language === 'ja' ? 'jp' : language}`]),
    '--whisper-task=transcribe',
    '--whisper-tail-paddings=300',
  ];
}

export function parseSherpaTranscription(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const resultLine = lines.findLast(line => line.startsWith('text='));
  if (resultLine) return resultLine.slice('text='.length).trim();
  const jsonLine = lines.findLast(line => line.startsWith('{') && line.endsWith('}'));
  if (jsonLine) {
    try {
      const value = JSON.parse(jsonLine) as { text?: unknown };
      if (typeof value.text === 'string') return value.text.trim();
    } catch {
      // Fall through to the stable text-line parser below.
    }
  }
  return '';
}
