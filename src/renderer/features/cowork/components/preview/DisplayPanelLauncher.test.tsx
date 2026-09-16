// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import DisplayPanelLauncher from './DisplayPanelLauncher';

afterEach(cleanup);

describe('DisplayPanelLauncher', () => {
  it('offers browser and terminal without showing the unsupported file option', () => {
    i18nService.setLanguage('en', { persist: false });
    const createBrowser = vi.fn();
    const createTerminal = vi.fn();

    render(
      <DisplayPanelLauncher onCreateBrowser={createBrowser} onCreateTerminal={createTerminal} />,
    );

    expect(screen.queryByRole('button', { name: 'File' })).toBeNull();
    const browserButton = screen.getByRole('button', { name: 'Browser' });
    expect(browserButton.parentElement?.classList.contains('justify-center')).toBe(true);
    fireEvent.click(browserButton);
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    expect(createBrowser).toHaveBeenCalledTimes(1);
    expect(createTerminal).toHaveBeenCalledTimes(1);
  });

  it('disables unavailable launch targets', () => {
    i18nService.setLanguage('en', { persist: false });

    render(
      <DisplayPanelLauncher
        browserDisabled
        terminalDisabled
        onCreateBrowser={vi.fn()}
        onCreateTerminal={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Browser' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Terminal' }).hasAttribute('disabled')).toBe(true);
  });
});
