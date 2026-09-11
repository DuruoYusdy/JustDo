import { describe, expect, it } from 'vitest';

import {
  defaultLocalSpeechSettings,
  normalizeLocalSpeechSettings,
  resolveLocalSpeechInputLanguage,
} from './localSpeechSettings';

describe('local speech settings', () => {
  it('uses stable defaults for missing settings', () => {
    expect(normalizeLocalSpeechSettings(undefined)).toEqual(defaultLocalSpeechSettings);
  });

  it('clamps persisted and untrusted numeric values', () => {
    expect(
      normalizeLocalSpeechSettings({
        maxRecordingSeconds: 999,
        recognitionThreads: 0,
        synthesisThreads: 3.6,
        voiceId: -4,
        speechRate: 0.1,
      }),
    ).toMatchObject({
      maxRecordingSeconds: 120,
      recognitionThreads: 1,
      synthesisThreads: 4,
      voiceId: 0,
      speechRate: 0.5,
    });
  });

  it('resolves the app-language recognition mode', () => {
    expect(resolveLocalSpeechInputLanguage('app', 'zh')).toBe('zh');
    expect(resolveLocalSpeechInputLanguage('en', 'zh')).toBe('en');
  });

  it('keeps supported model and capture-source selections while rejecting unknown values', () => {
    expect(
      normalizeLocalSpeechSettings({
        asrModelId: 'sherpa-onnx-whisper-base',
        ttsModelId: 'vits-icefall-zh-aishell3',
        inputSource: 'microphone-system',
        inputDeviceId: 'usb-microphone',
        meetingMode: true,
        meetingSegmentSeconds: 5,
      }),
    ).toMatchObject({
      asrModelId: 'sherpa-onnx-whisper-base',
      ttsModelId: 'vits-icefall-zh-aishell3',
      inputSource: 'microphone-system',
      inputDeviceId: 'usb-microphone',
      meetingMode: true,
      meetingSegmentSeconds: 15,
    });

    expect(
      normalizeLocalSpeechSettings({
        asrModelId: 'unknown',
        ttsModelId: 'unknown',
        inputSource: 'unknown',
      }),
    ).toMatchObject({
      asrModelId: defaultLocalSpeechSettings.asrModelId,
      ttsModelId: defaultLocalSpeechSettings.ttsModelId,
      inputSource: defaultLocalSpeechSettings.inputSource,
    });
  });

  it('clamps speaker IDs to the selected synthesis model', () => {
    expect(
      normalizeLocalSpeechSettings({
        ttsModelId: 'vits-icefall-zh-aishell3',
        voiceId: 999,
      }).voiceId,
    ).toBe(173);
    expect(
      normalizeLocalSpeechSettings({
        ttsModelId: 'vits-piper-en_US-lessac-medium-int8',
        voiceId: 42,
      }).voiceId,
    ).toBe(0);
  });
});
