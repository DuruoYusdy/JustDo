// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import UnsupportedFilePreview from './UnsupportedFilePreview';

const openPath = vi.fn();
const openPathWith = vi.fn();
const showItemInFolder = vi.fn();

beforeEach(() => {
  i18nService.setLanguage('zh', { persist: false });
  vi.clearAllMocks();
  openPath.mockResolvedValue({ success: true });
  openPathWith.mockResolvedValue({ success: true });
  showItemInFolder.mockResolvedValue({ success: true });
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { shell: { openPath, openPathWith, showItemInFolder } },
  });
});

afterEach(cleanup);

test('shows an inline unsupported preview with all system actions', async () => {
  const filePath = 'C:\\workspace\\archive.zip';
  const onClose = vi.fn();
  render(<UnsupportedFilePreview filePath={filePath} onClose={onClose} />);

  expect(screen.getByText('暂不支持预览此文件类型')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开所在文件夹' }));
  await waitFor(() => expect(showItemInFolder).toHaveBeenCalledWith(filePath));
  fireEvent.click(screen.getByRole('button', { name: '使用系统默认应用打开' }));
  await waitFor(() => expect(openPath).toHaveBeenCalledWith(filePath));
  fireEvent.click(screen.getByRole('button', { name: '选择打开方式…' }));
  await waitFor(() => expect(openPathWith).toHaveBeenCalledWith(filePath));
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalledOnce();
});

test('reports when the native app chooser is unavailable', async () => {
  openPathWith.mockResolvedValue({ success: false, unavailable: true });
  const toast = vi.fn();
  window.addEventListener('app:showToast', toast);
  render(<UnsupportedFilePreview filePath="/tmp/archive.zip" onClose={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: '选择打开方式…' }));

  await waitFor(() => expect(toast).toHaveBeenCalledOnce());
  expect((toast.mock.calls[0]?.[0] as CustomEvent<string>).detail).toContain('不支持');
  window.removeEventListener('app:showToast', toast);
});
