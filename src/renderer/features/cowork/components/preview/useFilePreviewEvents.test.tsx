/** @vitest-environment jsdom */
import type { FilePreviewReadResult } from '@shared/filePreview';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import type { FilePreview } from './FilePreviewDrawer';
import { IMAGE_PREVIEW_EVENT } from './imageFilePreview';
import { useFilePreviewEvents } from './useFilePreviewEvents';

const fileDisplayTabId = (path: string) => `file:${path.replace(/\\/g, '/')}`;
const imageSource = 'data:image/png;base64,AA==';

function usePreviewHarness() {
  const currentSessionIdRef = useRef<string | null>('session-a');
  const filePreviewRequestIdRef = useRef(0);
  const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]);
  const [unsupportedFilePreviews, setUnsupportedFilePreviews] = useState<string[]>([]);
  const [preferredDisplayTabId, setPreferredDisplayTabId] = useState<string | null>(null);
  const [isDisplayPanelOpen, setIsDisplayPanelOpen] = useState(false);
  const [, setIsWorkspaceFilesOpen] = useState(false);
  const filePreviewsRef = useRef(filePreviews);
  const unsupportedFilePreviewsRef = useRef(unsupportedFilePreviews);
  filePreviewsRef.current = filePreviews;
  unsupportedFilePreviewsRef.current = unsupportedFilePreviews;
  useFilePreviewEvents({
    currentSessionIdRef,
    filePreviewRequestIdRef,
    filePreviewsRef,
    unsupportedFilePreviewsRef,
    fileDisplayTabId,
    setFilePreviews,
    setUnsupportedFilePreviews,
    setPreferredDisplayTabId,
    setIsDisplayPanelOpen,
    setIsWorkspaceFilesOpen,
  });
  return { filePreviews, preferredDisplayTabId, isDisplayPanelOpen };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each(['file', 'thumbnail', 'existing-image'])(
  'keeps the %s selected when a slower text read completes',
  async entry => {
    let finishRead!: (result: FilePreviewReadResult) => void;
    const readPreviewFile = vi.fn(
      () =>
        new Promise<FilePreviewReadResult>(resolve => {
          finishRead = resolve;
        }),
    );
    const revokePreviewFileEdit = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('electron', { shell: { readPreviewFile, revokePreviewFileEdit } });
    const { result } = renderHook(usePreviewHarness);
    const imageEvent = () =>
      entry === 'file'
        ? new CustomEvent('cowork:preview-file', { detail: { filePath: 'E:/output/image.png' } })
        : new CustomEvent(IMAGE_PREVIEW_EVENT, { detail: { src: imageSource, alt: 'image' } });
    if (entry === 'existing-image')
      act(() => {
        window.dispatchEvent(imageEvent());
      });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('cowork:preview-file', { detail: { filePath: 'E:/output/notes.txt' } }),
      );
    });
    act(() => {
      window.dispatchEvent(imageEvent());
    });
    const selectedImageTab = result.current.preferredDisplayTabId;
    expect(result.current.filePreviews).toHaveLength(1);
    expect(result.current.filePreviews[0].kind).toBe('image');
    expect(result.current.isDisplayPanelOpen).toBe(true);

    await act(async () => {
      finishRead({
        success: true,
        filePath: 'E:/output/notes.txt',
        content: 'notes',
        editToken: 'old-grant',
        version: '1',
      });
    });

    expect(result.current.preferredDisplayTabId).toBe(selectedImageTab);
    expect(result.current.filePreviews).toHaveLength(1);
    expect(revokePreviewFileEdit).toHaveBeenCalledWith('old-grant');
  },
);

test('does not surface errors from a text request superseded by an image', async () => {
  let rejectRead!: (error: Error) => void;
  const readPreviewFile = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        rejectRead = reject;
      }),
  );
  vi.stubGlobal('electron', { shell: { readPreviewFile } });
  const dispatch = vi.spyOn(window, 'dispatchEvent');
  renderHook(usePreviewHarness);
  act(() => {
    window.dispatchEvent(
      new CustomEvent('cowork:preview-file', { detail: { filePath: 'E:/notes.txt' } }),
    );
  });
  act(() => {
    window.dispatchEvent(new CustomEvent(IMAGE_PREVIEW_EVENT, { detail: { src: imageSource } }));
  });
  dispatch.mockClear();
  await act(async () => {
    rejectRead(new Error('read failed'));
  });
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'app:showToast' }));
});
