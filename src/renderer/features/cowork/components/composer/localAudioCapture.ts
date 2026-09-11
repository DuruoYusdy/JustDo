export function encodeAudioBufferToWav(audio: AudioBuffer): Uint8Array {
  const channelCount = audio.numberOfChannels;
  const frameCount = audio.length;
  const bytes = new Uint8Array(44 + frameCount * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, frameCount * 2, true);

  const channels = Array.from({ length: channelCount }, (_, index) => audio.getChannelData(index));
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sample = 0;
    for (const channel of channels) sample += channel[frame] ?? 0;
    sample = Math.max(-1, Math.min(1, sample / channelCount));
    view.setInt16(44 + frame * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

export async function recordedAudioToWav(blob: Blob): Promise<Uint8Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    return encodeAudioBufferToWav(decoded);
  } finally {
    await context.close();
  }
}

export async function recordedAudioToWavSegments(
  blob: Blob,
  segmentSeconds: number,
): Promise<Uint8Array[]> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const framesPerSegment = Math.max(1, Math.floor(decoded.sampleRate * segmentSeconds));
    const segments: Uint8Array[] = [];
    for (let offset = 0; offset < decoded.length; offset += framesPerSegment) {
      const frameCount = Math.min(framesPerSegment, decoded.length - offset);
      const segment = context.createBuffer(decoded.numberOfChannels, frameCount, decoded.sampleRate);
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        segment.copyToChannel(
          decoded.getChannelData(channel).subarray(offset, offset + frameCount),
          channel,
        );
      }
      segments.push(encodeAudioBufferToWav(segment));
    }
    return segments;
  } finally {
    await context.close();
  }
}
