// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import DisplayPanelLauncher from './DisplayPanelLauncher';

afterEach(cleanup);

describe('DisplayPanelLauncher', () => {
  it('offers workspace files, browser, and terminal', () => {
    i18nService.setLanguage('en', { persist: false });
    const createBrowser = vi.fn();
    const createTerminal = vi.fn();
    const openFiles = vi.fn();

    render(
      <DisplayPanelLauncher
        onCreateBrowser={createBrowser}
        onCreateTerminal={createTerminal}
        onOpenFiles={openFiles}
      />,
    );

    expect(screen.getByRole('button', { name: 'Browser' }).parentElement?.classList).toContain(
      'bg-background',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    const browserButton = screen.getByRole('button', { name: 'Browser' });
    expect(browserButton.classList.contains('max-w-72')).toBe(true);
    expect(browserButton.classList.contains('mx-auto')).toBe(true);
    expect(browserButton.parentElement?.classList.contains('justify-center')).toBe(true);
    fireEvent.click(browserButton);
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    expect(createBrowser).toHaveBeenCalledTimes(1);
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(openFiles).toHaveBeenCalledTimes(1);
  });

  it('disables unavailable launch targets', () => {
    i18nService.setLanguage('en', { persist: false });

    render(
      <DisplayPanelLauncher
        browserDisabled
        filesDisabled
        terminalDisabled
        onCreateBrowser={vi.fn()}
        onCreateTerminal={vi.fn()}
        onOpenFiles={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Browser' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Terminal' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Files' }).hasAttribute('disabled')).toBe(true);
  });

  it('hides workspace files when no workspace is configured', () => {
    i18nService.setLanguage('en', { persist: false });

    render(<DisplayPanelLauncher onCreateBrowser={vi.fn()} onCreateTerminal={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Files' })).toBeNull();
  });
});
