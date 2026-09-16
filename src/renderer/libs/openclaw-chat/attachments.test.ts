import { describe, expect, test } from 'vitest';

import { getTranscriptMedia, isTranscriptImage } from './attachments';

describe('transcript media', () => {
  test('treats canonical durable OpenClaw media facts as authoritative over legacy fields', () => {
    expect(
      getTranscriptMedia({
        role: 'user',
        __openclaw: {
          media: [
            {
              path: 'media://inbound/photo---id.png',
              contentType: 'image/png',
              kind: 'image',
              fileName: 'photo.png',
            },
          ],
        },
        MediaPaths: ['C:\\legacy\\photo.png'],
        MediaTypes: ['image/png'],
      }),
    ).toEqual([
      {
        path: 'media://inbound/photo---id.png',
        mimeType: 'image/png',
        kind: 'image',
        fileName: 'photo.png',
      },
    ]);
  });

  test('accepts canonical URLs and removes a duplicate legacy path', () => {
    expect(
      getTranscriptMedia({
        __openclaw: { media: [{ url: 'https://example.test/photo.webp' }] },
        MediaPath: 'https://example.test/photo.webp',
        MediaType: 'image/webp',
      }),
    ).toEqual([{ path: 'https://example.test/photo.webp', mimeType: 'image/webp' }]);
  });

  test('preserves legacy MediaUrls positional alignment and fills sparse canonical facts', () => {
    expect(
      getTranscriptMedia({
        __openclaw: {
          media: [
            { url: 'media://inbound/canonical', kind: 'image' },
            { contentType: 'image/webp', fileName: 'second.webp' },
          ],
        },
        MediaPaths: ['', ''],
        MediaUrls: ['media://inbound/ignored', 'media://inbound/legacy-second'],
        MediaTypes: ['image/png', 'application/octet-stream'],
      }),
    ).toEqual([
      {
        path: 'media://inbound/canonical',
        mimeType: 'image/png',
        kind: 'image',
      },
      {
        path: 'media://inbound/legacy-second',
        mimeType: 'image/webp',
        fileName: 'second.webp',
      },
    ]);

    expect(
      getTranscriptMedia({
        MediaUrl: 'media://inbound/legacy-single',
        MediaType: 'image/jpeg',
      }),
    ).toEqual([{ path: 'media://inbound/legacy-single', mimeType: 'image/jpeg' }]);
  });

  test('recognizes images from MIME, canonical kind, or path extension', () => {
    expect(isTranscriptImage({ path: 'media://inbound/no-extension', kind: 'image' })).toBe(true);
    expect(isTranscriptImage({ path: '/tmp/blob', mimeType: 'image/jpeg' })).toBe(true);
    expect(isTranscriptImage({ path: 'https://example.test/photo.avif?size=large' })).toBe(true);
    expect(isTranscriptImage({ path: 'media://inbound/report.pdf', kind: 'document' })).toBe(false);
    expect(isTranscriptImage({ path: '/tmp/misleading.png', kind: 'document' })).toBe(false);
    expect(isTranscriptImage({ path: '/tmp/misleading.png', mimeType: 'text/plain' })).toBe(false);
    expect(
      isTranscriptImage({
        path: '/tmp/no-extension',
        mimeType: 'image/png',
        kind: 'document',
      }),
    ).toBe(true);
  });
});
