// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import TerminalTabContextMenu from './TerminalTabContextMenu';

const setPlatform = (platform: string) => {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { platform },
  });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TerminalTabContextMenu', () => {
  it('identifies the external Windows system terminal and opens it', () => {
    i18nService.setLanguage('en', { persist: false });
    setPlatform('win32');
    const openSystemTerminal = vi.fn();

    render(
      <TerminalTabContextMenu
        x={40}
        y={60}
        onDismiss={vi.fn()}
        onOpenSystemTerminal={openSystemTerminal}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Windows system terminal' }));
    expect(openSystemTerminal).toHaveBeenCalledOnce();
  });

  it('uses platform-specific wording and supports dismissal', () => {
    i18nService.setLanguage('en', { persist: false });
    setPlatform('darwin');
    const dismiss = vi.fn();

    render(
      <TerminalTabContextMenu x={40} y={60} onDismiss={dismiss} onOpenSystemTerminal={vi.fn()} />,
    );

    expect(screen.getByRole('menuitem', { name: 'Open in macOS system terminal' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Terminal tab menu' }), { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
