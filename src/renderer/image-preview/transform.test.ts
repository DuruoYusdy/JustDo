import { describe, expect, test } from 'vitest';

import {
  createImagePreviewTransform,
  IMAGE_PREVIEW_MAX_SCALE,
  IMAGE_PREVIEW_MIN_SCALE,
  zoomImagePreviewTransform,
} from './transform';

describe('image preview transform', () => {
  test('starts fitted and centered', () => {
    expect(createImagePreviewTransform()).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });

  test.each([-120, 120, 10_000])(
    'keeps the image point beneath the pointer fixed for wheel delta %s',
    wheelDeltaY => {
      const current = { scale: 2, offsetX: 20, offsetY: -10 };
      const next = zoomImagePreviewTransform({
        transform: current,
        wheelDeltaY,
        pointerX: 700,
        pointerY: 250,
        viewportCenterX: 500,
        viewportCenterY: 400,
      });

      const currentImagePointX = (700 - 500 - current.offsetX) / current.scale;
      const currentImagePointY = (250 - 400 - current.offsetY) / current.scale;
      const nextImagePointX = (700 - 500 - next.offsetX) / next.scale;
      const nextImagePointY = (250 - 400 - next.offsetY) / next.scale;

      if (wheelDeltaY < 0) expect(next.scale).toBeGreaterThan(current.scale);
      else expect(next.scale).toBeLessThan(current.scale);
      expect(nextImagePointX).toBeCloseTo(currentImagePointX);
      expect(nextImagePointY).toBeCloseTo(currentImagePointY);
    },
  );

  test('zooms out below the initial fitted size', () => {
    const next = zoomImagePreviewTransform({
      transform: createImagePreviewTransform(),
      wheelDeltaY: 120,
      pointerX: 0,
      pointerY: 0,
      viewportCenterX: 0,
      viewportCenterY: 0,
    });
    expect(next.scale).toBeLessThan(1);
    expect(next.scale).toBeGreaterThan(IMAGE_PREVIEW_MIN_SCALE);
  });

  test('clamps zoom out at the minimum without resetting the image', () => {
    const options = {
      transform: createImagePreviewTransform(),
      wheelDeltaY: 10_000,
      pointerX: 0,
      pointerY: 0,
      viewportCenterX: 0,
      viewportCenterY: 0,
    };
    const minimum = zoomImagePreviewTransform(options);
    expect(minimum.scale).toBe(IMAGE_PREVIEW_MIN_SCALE);
    expect(zoomImagePreviewTransform({ ...options, transform: minimum })).toBe(minimum);
  });

  test('caps zoom at the maximum scale', () => {
    const transform = { scale: IMAGE_PREVIEW_MAX_SCALE, offsetX: 10, offsetY: 20 };
    expect(
      zoomImagePreviewTransform({
        transform,
        wheelDeltaY: -10_000,
        pointerX: 0,
        pointerY: 0,
        viewportCenterX: 0,
        viewportCenterY: 0,
      }),
    ).toBe(transform);
  });
});
