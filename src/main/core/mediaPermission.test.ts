import { describe, expect, it } from 'vitest';

import {
  shouldAllowAudioMediaCheck,
  shouldAllowAudioMediaRequest,
  shouldAllowSystemAudioCapture,
} from './mediaPermission';

describe('media permission policy', () => {
  it('allows main-window audio checks when optional Electron details are absent', () => {
    expect(shouldAllowAudioMediaCheck(true, {})).toBe(true);
    expect(shouldAllowAudioMediaRequest(true)).toBe(true);
    expect(shouldAllowAudioMediaRequest(true, [])).toBe(true);
  });

  it('allows explicit main-window microphone requests', () => {
    expect(shouldAllowAudioMediaCheck(true, { isMainFrame: true, mediaType: 'audio' })).toBe(true);
    expect(shouldAllowAudioMediaRequest(true, ['audio'])).toBe(true);
  });

  it('rejects video, subframe, and foreign-window requests', () => {
    expect(shouldAllowAudioMediaCheck(true, { isMainFrame: true, mediaType: 'video' })).toBe(false);
    expect(shouldAllowAudioMediaCheck(true, { isMainFrame: false, mediaType: 'audio' })).toBe(
      false,
    );
    expect(shouldAllowAudioMediaRequest(true, ['audio', 'video'])).toBe(false);
    expect(shouldAllowAudioMediaRequest(false, ['audio'])).toBe(false);
  });

  it('allows Windows system-audio capture from a top-level display request', () => {
    expect(
      shouldAllowSystemAudioCapture({
        audioRequested: true,
        authorizedByRenderer: true,
        isMainFrame: true,
        videoRequested: true,
        isWindows: true,
      }),
    ).toBe(true);
  });

  it('rejects incomplete or non-Windows system-audio capture requests', () => {
    const validRequest = {
      audioRequested: true,
      authorizedByRenderer: true,
      isMainFrame: true,
      videoRequested: true,
      isWindows: true,
    };
    expect(shouldAllowSystemAudioCapture({ ...validRequest, audioRequested: false })).toBe(false);
    expect(shouldAllowSystemAudioCapture({ ...validRequest, videoRequested: false })).toBe(false);
    expect(shouldAllowSystemAudioCapture({ ...validRequest, isMainFrame: false })).toBe(false);
    expect(shouldAllowSystemAudioCapture({ ...validRequest, authorizedByRenderer: false })).toBe(
      false,
    );
    expect(shouldAllowSystemAudioCapture({ ...validRequest, isWindows: false })).toBe(false);
  });
});
