import { describe, expect, it } from 'vitest';

import { encodeAudioBufferToWav } from './localAudioCapture';

describe('local audio capture', () => {
  it('encodes and downmixes browser audio into mono PCM16 WAV', () => {
    const audio = {
      numberOfChannels: 2,
      length: 2,
      sampleRate: 16_000,
      getChannelData: (channel: number) =>
        channel === 0 ? new Float32Array([1, -1]) : new Float32Array([0, 0]),
    } as AudioBuffer;

    const wav = encodeAudioBufferToWav(audio);
    const view = new DataView(wav.buffer);

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(4);
    expect(view.getInt16(44, true)).toBe(16_383);
    expect(view.getInt16(46, true)).toBe(-16_384);
  });
});
