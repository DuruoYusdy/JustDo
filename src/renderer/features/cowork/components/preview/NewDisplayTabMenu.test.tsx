// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import NewDisplayTabMenu from './NewDisplayTabMenu';

afterEach(cleanup);

describe('NewDisplayTabMenu', () => {
  it('offers browser and terminal creation without opening either by default', () => {
    i18nService.setLanguage('en', { persist: false });
    const createBrowser = vi.fn();
    const createTerminal = vi.fn();
    render(<NewDisplayTabMenu onCreateBrowser={createBrowser} onCreateTerminal={createTerminal} />);

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Browser',
      'Terminal',
    ]);
    expect(createBrowser).not.toHaveBeenCalled();
    expect(createTerminal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }));
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disables unavailable tab types', () => {
    i18nService.setLanguage('en', { persist: false });
    render(
      <NewDisplayTabMenu
        browserDisabled
        terminalDisabled
        onCreateBrowser={vi.fn()}
        onCreateTerminal={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(screen.getByRole('menuitem', { name: 'Browser' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('menuitem', { name: 'Terminal' }).hasAttribute('disabled')).toBe(true);
  });

  it('supports menu arrow navigation and returns focus on Escape', async () => {
    i18nService.setLanguage('en', { persist: false });
    render(<NewDisplayTabMenu onCreateBrowser={vi.fn()} onCreateTerminal={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'New tab' });
    fireEvent.click(trigger);
    const browser = screen.getByRole('menuitem', { name: 'Browser' });
    const terminal = screen.getByRole('menuitem', { name: 'Terminal' });
    await waitFor(() => expect(document.activeElement).toBe(browser));

    fireEvent.keyDown(browser, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(terminal);
    fireEvent.keyDown(terminal, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
