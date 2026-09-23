/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import ImageFilePreviewPanel from './ImageFilePreviewPanel';

afterEach(cleanup);

it('zooms and resets the image inside the tab, and reports load failures', () => {
  const onClose = vi.fn();
  render(
    <ImageFilePreviewPanel
      preview={{
        kind: 'image',
        filePath: '/tmp/a.png',
        src: 'localfile:///tmp/a.png',
        label: 'a.png',
      }}
      onClose={onClose}
    />,
  );
  const image = screen.getByRole('img') as HTMLImageElement;
  expect(image.src).toBe('localfile:///tmp/a.png');
  const scale = () => Number(image.style.transform.match(/scale\(([^)]+)\)/)?.[1]);
  fireEvent.wheel(image.parentElement!, { deltaY: 300 });
  expect(scale()).toBeLessThan(1);
  fireEvent.doubleClick(image);
  expect(scale()).toBe(1);
  fireEvent.wheel(image.parentElement!, { deltaY: -300 });
  expect(scale()).toBeGreaterThan(1);
  fireEvent.wheel(image.parentElement!, { deltaY: 600 });
  expect(scale()).toBeLessThan(1);
  fireEvent.doubleClick(image);
  expect(image.style.transform).toContain('scale(1)');
  fireEvent.error(image);
  expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button')[1]);
  expect(onClose).toHaveBeenCalledTimes(1);
});
