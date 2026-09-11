#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const SHERPA_VERSION = '1.13.7';
const MODEL_ID = 'kokoro-int8-multi-lang-v1_1';
const ASR_MODEL_ID = 'sherpa-onnx-whisper-tiny';
const RUNTIME_ARCHIVE = `sherpa-onnx-v${SHERPA_VERSION}-win-x64-shared-MD-MinSizeRel.tar.bz2`;
const MODEL_ARCHIVE = `${MODEL_ID}.tar.bz2`;
const ASR_MODEL_ARCHIVE = `${ASR_MODEL_ID}.tar.bz2`;
const RUNTIME_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/${RUNTIME_ARCHIVE}`;
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${MODEL_ARCHIVE}`;
const ASR_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${ASR_MODEL_ARCHIVE}`;
const ASR_MODEL_LICENSE_URL = 'https://raw.githubusercontent.com/openai/whisper/v20250625/LICENSE';
const RUNTIME_LICENSE_URL = `https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v${SHERPA_VERSION}/LICENSE`;
const RUNTIME_SHA256 = '16d96d9f4787a698541fc53740077f70b5c8a76ef36aff803503de1aa036ede7';
const MODEL_SHA256 = 'a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6';
const ASR_MODEL_SHA256 = 'c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1';
const ASR_MODEL_LICENSE_SHA256 = 'b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d';
const RUNTIME_LICENSE_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';
const ADDITIONAL_MODELS = [
  {
    id: 'sherpa-onnx-whisper-base',
    archive: 'sherpa-onnx-whisper-base.tar.bz2',
    release: 'asr-models',
    sha256: '911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de',
    licenseUrl: ASR_MODEL_LICENSE_URL,
    licenseSha256: ASR_MODEL_LICENSE_SHA256,
    requiredFiles: ['base-encoder.int8.onnx', 'base-decoder.int8.onnx', 'base-tokens.txt'],
    prune: ['base-encoder.onnx', 'base-decoder.onnx', 'test_wavs'],
  },
  {
    id: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
    archive: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2',
    release: 'asr-models',
    sha256: '7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63',
    licenseUrl: 'https://raw.githubusercontent.com/FunAudioLLM/SenseVoice/main/LICENSE',
    licenseSha256: '4bc3bffe14ebe38cc67309991e04f92866835eac1c5e2e1abd37163f67c6de5f',
    requiredFiles: ['model.int8.onnx', 'tokens.txt'],
    prune: ['test_wavs'],
  },
  {
    id: 'vits-icefall-zh-aishell3',
    archive: 'vits-icefall-zh-aishell3.tar.bz2',
    release: 'tts-models',
    sha256: 'ab468db3a3308cdd861495e0db2f25d79418a0c00639f74944c7cdf5dd8c6ec1',
    licenseUrl: 'https://raw.githubusercontent.com/k2-fsa/icefall/master/LICENSE',
    licenseSha256: RUNTIME_LICENSE_SHA256,
    requiredFiles: ['model.onnx', 'tokens.txt', 'lexicon.txt', 'phone.fst', 'date.fst', 'number.fst'],
    prune: ['rule.far'],
  },
  {
    id: 'vits-piper-en_US-lessac-medium-int8',
    archive: 'vits-piper-en_US-lessac-medium-int8.tar.bz2',
    release: 'tts-models',
    sha256: 'f1c6d0295cf16087b05f80fdca5b44daca5cd78e2c425d419a42ba34929805f9',
    licenseUrl: 'https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html',
    licenseSha256: '32707e81ea2a1decb5a4e75d5a9f623063e6b749046a531d4ac1e5d0d029573c',
    requiredFiles: ['en_US-lessac-medium.onnx', 'tokens.txt', 'espeak-ng-data'],
    prune: [],
  },
];

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'resources', 'local-tts', 'win-x64');
const CACHE_ROOT = path.join(PROJECT_ROOT, 'resources', 'local-tts-cache');
const RUNTIME_ROOT = path.join(OUTPUT_ROOT, 'runtime');
const EXECUTABLE_PATH = path.join(RUNTIME_ROOT, 'bin', 'sherpa-onnx-offline-tts.exe');
const ASR_EXECUTABLE_PATH = path.join(RUNTIME_ROOT, 'bin', 'sherpa-onnx-offline.exe');
const MODEL_ROOT = path.join(OUTPUT_ROOT, MODEL_ID);
const ASR_MODEL_ROOT = path.join(OUTPUT_ROOT, ASR_MODEL_ID);
const VERSION_MARKER = path.join(OUTPUT_ROOT, '.justdo-local-speech-runtime-version');
const EXPECTED_VERSION_MARKER = `sherpa-onnx=${SHERPA_VERSION}\n`;
const REQUIRED_MODEL_FILES = [
  'model.int8.onnx',
  'voices.bin',
  'tokens.txt',
  'espeak-ng-data',
  'lexicon-us-en.txt',
  'lexicon-zh.txt',
  'phone-zh.fst',
  'date-zh.fst',
  'number-zh.fst',
];

function isPrepared() {
  return (
    fs.existsSync(EXECUTABLE_PATH) &&
    fs.existsSync(ASR_EXECUTABLE_PATH) &&
    fs.existsSync(path.join(OUTPUT_ROOT, 'SHERPA-ONNX-LICENSE.txt')) &&
    fs
      .readdirSync(path.join(RUNTIME_ROOT, 'bin'))
      .filter(file => file.endsWith('.exe'))
      .every(file => ['sherpa-onnx-offline-tts.exe', 'sherpa-onnx-offline.exe'].includes(file)) &&
    fs.existsSync(VERSION_MARKER) &&
    fs.readFileSync(VERSION_MARKER, 'utf8') === EXPECTED_VERSION_MARKER
  );
}

function areModelsPrepared() {
  return (
    fs.existsSync(path.join(OUTPUT_ROOT, 'KOKORO-LICENSE.txt')) &&
    fs.existsSync(path.join(OUTPUT_ROOT, 'WHISPER-LICENSE.txt')) &&
    REQUIRED_MODEL_FILES.every(file => fs.existsSync(path.join(MODEL_ROOT, file))) &&
    ['tiny-encoder.int8.onnx', 'tiny-decoder.int8.onnx', 'tiny-tokens.txt'].every(file =>
      fs.existsSync(path.join(ASR_MODEL_ROOT, file)),
    ) &&
    ADDITIONAL_MODELS.every(model =>
      [...model.requiredFiles, 'LICENSE'].every(file =>
        fs.existsSync(path.join(OUTPUT_ROOT, model.id, file)),
      ),
    )
  );
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function download(url, destination, expectedSha256) {
  if (fs.existsSync(destination)) {
    if ((await sha256(destination)) === expectedSha256) return;
    fs.rmSync(destination, { force: true });
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.rmSync(temporary, { force: true });
  console.log(`[setup-local-tts] Downloading ${path.basename(destination)}...`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
  const actual = await sha256(temporary);
  if (actual !== expectedSha256) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`SHA-256 mismatch for ${path.basename(destination)}: ${actual}`);
  }
  fs.renameSync(temporary, destination);
}

function extractModel(archivePath) {
  let path7za;
  try {
    ({ path7za } = require('7zip-bin'));
  } catch (error) {
    throw new Error(`Missing 7zip-bin; run npm install first. ${error.message}`);
  }

  const staging = path.join(CACHE_ROOT, `extract-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const input of [archivePath, path.join(staging, `${MODEL_ID}.tar`)]) {
      const result = spawnSync(path7za, ['x', input, `-o${staging}`, '-y'], { stdio: 'inherit' });
      if (result.status !== 0) {
        throw result.error || new Error(`7-Zip extraction failed with exit code ${result.status}`);
      }
    }
    const extracted = path.join(staging, MODEL_ID);
    if (!fs.existsSync(extracted)) throw new Error(`Model archive did not contain ${MODEL_ID}`);
    fs.rmSync(MODEL_ROOT, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    fs.renameSync(extracted, MODEL_ROOT);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function extractRuntime(archivePath) {
  let path7za;
  try {
    ({ path7za } = require('7zip-bin'));
  } catch (error) {
    throw new Error(`Missing 7zip-bin; run npm install first. ${error.message}`);
  }

  const staging = path.join(CACHE_ROOT, `runtime-${process.pid}`);
  const tarPath = path.join(staging, RUNTIME_ARCHIVE.replace(/\.bz2$/, ''));
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const input of [archivePath, tarPath]) {
      const result = spawnSync(path7za, ['x', input, `-o${staging}`, '-y'], { stdio: 'inherit' });
      if (result.status !== 0) {
        throw result.error || new Error(`7-Zip extraction failed with exit code ${result.status}`);
      }
    }
    const extracted = fs
      .readdirSync(staging, { withFileTypes: true })
      .find(
        entry => entry.isDirectory() && entry.name.startsWith(`sherpa-onnx-v${SHERPA_VERSION}`),
      );
    if (!extracted) throw new Error('Runtime archive did not contain the expected directory.');
    fs.rmSync(RUNTIME_ROOT, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    fs.renameSync(path.join(staging, extracted.name), RUNTIME_ROOT);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function extractAsrModel(archivePath) {
  let path7za;
  try {
    ({ path7za } = require('7zip-bin'));
  } catch (error) {
    throw new Error(`Missing 7zip-bin; run npm install first. ${error.message}`);
  }

  const staging = path.join(CACHE_ROOT, `asr-${process.pid}`);
  const tarPath = path.join(staging, ASR_MODEL_ARCHIVE.replace(/\.bz2$/, ''));
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const input of [archivePath, tarPath]) {
      const result = spawnSync(path7za, ['x', input, `-o${staging}`, '-y'], { stdio: 'inherit' });
      if (result.status !== 0) {
        throw result.error || new Error(`7-Zip extraction failed with exit code ${result.status}`);
      }
    }
    const extracted = path.join(staging, ASR_MODEL_ID);
    if (!fs.existsSync(extracted)) throw new Error(`ASR archive did not contain ${ASR_MODEL_ID}`);
    fs.rmSync(ASR_MODEL_ROOT, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    fs.renameSync(extracted, ASR_MODEL_ROOT);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function extractAdditionalModel(archivePath, model) {
  let path7za;
  try {
    ({ path7za } = require('7zip-bin'));
  } catch (error) {
    throw new Error(`Missing 7zip-bin; run npm install first. ${error.message}`);
  }
  const staging = path.join(CACHE_ROOT, `model-${model.id}-${process.pid}`);
  const tarPath = path.join(staging, model.archive.replace(/\.bz2$/, ''));
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const input of [archivePath, tarPath]) {
      const result = spawnSync(path7za, ['x', input, `-o${staging}`, '-y'], { stdio: 'inherit' });
      if (result.status !== 0) {
        throw result.error || new Error(`7-Zip extraction failed with exit code ${result.status}`);
      }
    }
    const extracted = path.join(staging, model.id);
    if (!fs.existsSync(extracted)) throw new Error(`Model archive did not contain ${model.id}`);
    for (const relativePath of model.prune) {
      fs.rmSync(path.join(extracted, relativePath), { recursive: true, force: true });
    }
    const target = path.join(OUTPUT_ROOT, model.id);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(extracted, target);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function prepareAdditionalModels() {
  for (const model of ADDITIONAL_MODELS) {
    const archivePath = path.join(CACHE_ROOT, model.archive);
    const licensePath = path.join(CACHE_ROOT, `${model.id}-LICENSE`);
    const modelRoot = path.join(OUTPUT_ROOT, model.id);
    const complete = [...model.requiredFiles, 'LICENSE'].every(file =>
      fs.existsSync(path.join(modelRoot, file)),
    );
    if (complete) continue;
    await download(
      `https://github.com/k2-fsa/sherpa-onnx/releases/download/${model.release}/${model.archive}`,
      archivePath,
      model.sha256,
    );
    await download(model.licenseUrl, licensePath, model.licenseSha256);
    extractAdditionalModel(archivePath, model);
    fs.copyFileSync(licensePath, path.join(modelRoot, 'LICENSE'));
  }
}

function pruneRuntime() {
  const binDir = path.join(RUNTIME_ROOT, 'bin');
  for (const entry of fs.readdirSync(binDir, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      entry.name.endsWith('.exe') &&
      !['sherpa-onnx-offline-tts.exe', 'sherpa-onnx-offline.exe'].includes(entry.name)
    ) {
      fs.rmSync(path.join(binDir, entry.name), { force: true });
    }
  }
  for (const directory of ['include', 'lib']) {
    fs.rmSync(path.join(RUNTIME_ROOT, directory), { recursive: true, force: true });
  }
}

function pruneAsrModel() {
  for (const entry of fs.readdirSync(ASR_MODEL_ROOT, { withFileTypes: true })) {
    if (
      entry.name === 'tiny-encoder.onnx' ||
      entry.name === 'tiny-decoder.onnx' ||
      entry.name === 'test_wavs'
    ) {
      fs.rmSync(path.join(ASR_MODEL_ROOT, entry.name), { recursive: true, force: true });
    }
  }
}

async function ensureLocalTts(options = {}) {
  const includeModels = options.includeModels === true;
  if (isPrepared() && (!includeModels || areModelsPrepared())) {
    console.log('[setup-local-tts] Local speech assets are already prepared.');
    return;
  }

  if (!isPrepared()) {
    const runtimeArchive = path.join(CACHE_ROOT, RUNTIME_ARCHIVE);
    const runtimeLicense = path.join(CACHE_ROOT, 'sherpa-onnx-LICENSE');
    await download(RUNTIME_URL, runtimeArchive, RUNTIME_SHA256);
    await download(RUNTIME_LICENSE_URL, runtimeLicense, RUNTIME_LICENSE_SHA256);
    extractRuntime(runtimeArchive);
    pruneRuntime();
    fs.copyFileSync(runtimeLicense, path.join(RUNTIME_ROOT, 'LICENSE'));
    fs.copyFileSync(runtimeLicense, path.join(OUTPUT_ROOT, 'SHERPA-ONNX-LICENSE.txt'));
    fs.rmSync(
      path.join(OUTPUT_ROOT, `sherpa-onnx-non-streaming-tts-x64-v${SHERPA_VERSION}.exe`),
      { force: true },
    );
    fs.rmSync(path.join(OUTPUT_ROOT, 'sherpa-onnx-non-streaming-tts.exe'), { force: true });
    fs.writeFileSync(VERSION_MARKER, EXPECTED_VERSION_MARKER, 'utf8');
  }

  if (!isPrepared()) throw new Error('Local speech assets failed validation after extraction.');
  if (includeModels && !areModelsPrepared()) {
    const modelArchive = path.join(CACHE_ROOT, MODEL_ARCHIVE);
    const asrModelArchive = path.join(CACHE_ROOT, ASR_MODEL_ARCHIVE);
    const asrModelLicense = path.join(CACHE_ROOT, 'whisper-LICENSE');
    await download(MODEL_URL, modelArchive, MODEL_SHA256);
    await download(ASR_MODEL_URL, asrModelArchive, ASR_MODEL_SHA256);
    await download(ASR_MODEL_LICENSE_URL, asrModelLicense, ASR_MODEL_LICENSE_SHA256);
    extractModel(modelArchive);
    extractAsrModel(asrModelArchive);
    pruneAsrModel();
    fs.copyFileSync(path.join(MODEL_ROOT, 'LICENSE'), path.join(OUTPUT_ROOT, 'KOKORO-LICENSE.txt'));
    fs.copyFileSync(asrModelLicense, path.join(OUTPUT_ROOT, 'WHISPER-LICENSE.txt'));
    await prepareAdditionalModels();
  }
  if (includeModels && !areModelsPrepared()) {
    throw new Error('Local speech models failed validation after extraction.');
  }
  console.log(`[setup-local-tts] Prepared local speech assets at ${OUTPUT_ROOT}`);
}

if (require.main === module) {
  ensureLocalTts({ includeModels: process.argv.includes('--with-models') }).catch(error => {
    console.error(`[setup-local-tts] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { areModelsPrepared, ensureLocalTts, isPrepared };
