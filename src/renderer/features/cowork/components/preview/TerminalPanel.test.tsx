// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

const mocks = vi.hoisted(() => {
  const disposeInput = vi.fn();
  const terminal = {
    cols: 100,
    rows: 30,
    options: {},
    dispose: vi.fn(),
    focus: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn(() => ({ dispose: disposeInput })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
    open: vi.fn(),
    write: vi.fn(),
  };
  return {
    disposeInput,
    fit: vi.fn(),
    terminal,
    Terminal: vi.fn(function TerminalMock() {
      return terminal;
    }),
  };
});

vi.mock('@xterm/xterm', () => ({ Terminal: mocks.Terminal }));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddonMock() {
    return { fit: mocks.fit };
  }),
}));

import TerminalPanel from './TerminalPanel';

describe('TerminalPanel', () => {
  const create = vi.fn().mockResolvedValue({ success: true, cwd: 'E:\\workspace\\JustDo' });
  const close = vi.fn().mockResolvedValue({ success: true });
  const resize = vi.fn().mockResolvedValue({ success: true });
  const write = vi.fn().mockResolvedValue({ success: true });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        terminal: {
          create,
          close,
          resize,
          write,
          onData: vi.fn(() => vi.fn()),
          onExit: vi.fn(() => vi.fn()),
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts in the supplied project directory and closes the PTY on unmount', async () => {
    const view = render(
      <TerminalPanel terminalId="terminal:test" cwd={'E:\\workspace\\JustDo'} isObscured={false} />,
    );

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        id: 'terminal:test:00000000-0000-4000-8000-000000000001',
        cwd: 'E:\\workspace\\JustDo',
        cols: 100,
        rows: 30,
      }),
    );
    expect(mocks.Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        allowTransparency: false,
        drawBoldTextInBrightColors: true,
        fontFamily: expect.stringMatching(
          /^'MesloLGM Nerd Font'.*'MesloLGM Nerd Font Mono'.*'Microsoft YaHei'.*monospace$/,
        ),
        theme: expect.objectContaining({
          background: '#0c0c0c',
          foreground: '#cccccc',
          brightBlue: '#3b78ff',
          brightCyan: '#61d6d6',
        }),
      }),
    );
    view.unmount();
    await waitFor(() =>
      expect(close).toHaveBeenCalledWith('terminal:test:00000000-0000-4000-8000-000000000001'),
    );
    expect(mocks.terminal.dispose).toHaveBeenCalled();
  });

  it('reuses the backend PTY across the React StrictMode effect check', async () => {
    const exitListeners: Array<(event: { id: string; exitCode: number }) => void> = [];
    window.electron.terminal.onExit = vi.fn(listener => {
      exitListeners.push(listener);
      return vi.fn();
    });

    const view = render(
      <StrictMode>
        <TerminalPanel
          terminalId="terminal:strict"
          cwd={'E:\\workspace\\JustDo'}
          isObscured={false}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled();

    act(() => {
      exitListeners[exitListeners.length - 1]?.({
        id: 'terminal:strict:an-old-process',
        exitCode: -1_073_741_510,
      });
    });
    expect(mocks.terminal.write).not.toHaveBeenCalledWith(expect.stringContaining('-1073741510'));

    view.unmount();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it('shows a localized error when terminal creation IPC rejects', async () => {
    i18nService.setLanguage('en', { persist: false });
    create.mockRejectedValueOnce(new Error('IPC unavailable'));

    render(
      <TerminalPanel
        terminalId="terminal:rejected"
        cwd={'E:\\workspace\\JustDo'}
        isObscured={false}
      />,
    );

    await waitFor(() =>
      expect(mocks.terminal.write).toHaveBeenCalledWith('\r\nUnable to create terminal\r\n'),
    );
    expect(mocks.terminal.write).not.toHaveBeenCalledWith(
      expect.stringContaining('IPC unavailable'),
    );
  });
});
