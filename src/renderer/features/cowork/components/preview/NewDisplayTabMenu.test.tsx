// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import NewDisplayTabMenu from './NewDisplayTabMenu';

afterEach(cleanup);

describe('NewDisplayTabMenu', () => {
  it('offers files, browser, and terminal without opening any by default', () => {
    i18nService.setLanguage('en', { persist: false });
    const createBrowser = vi.fn();
    const createTerminal = vi.fn();
    const openFiles = vi.fn();
    render(
      <NewDisplayTabMenu
        onCreateBrowser={createBrowser}
        onCreateTerminal={createTerminal}
        onOpenFiles={openFiles}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Files',
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
        filesDisabled
        terminalDisabled
        onCreateBrowser={vi.fn()}
        onCreateTerminal={vi.fn()}
        onOpenFiles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(screen.getByRole('menuitem', { name: 'Browser' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('menuitem', { name: 'Terminal' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('menuitem', { name: 'Files' }).hasAttribute('disabled')).toBe(true);
  });

  it('hides workspace files when no workspace is configured', () => {
    i18nService.setLanguage('en', { persist: false });
    render(<NewDisplayTabMenu onCreateBrowser={vi.fn()} onCreateTerminal={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));

    expect(screen.queryByRole('menuitem', { name: 'Files' })).toBeNull();
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Browser',
      'Terminal',
    ]);
  });

  it('offers side chat for an existing session', () => {
    i18nService.setLanguage('en', { persist: false });
    const createSideChat = vi.fn();
    render(
      <NewDisplayTabMenu
        onCreateBrowser={vi.fn()}
        onCreateSideChat={createSideChat}
        onCreateTerminal={vi.fn()}
        onOpenFiles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Side chat',
      'Files',
      'Browser',
      'Terminal',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Side chat' }));
    expect(createSideChat).toHaveBeenCalledTimes(1);
  });

  it('supports menu arrow navigation and returns focus on Escape', async () => {
    i18nService.setLanguage('en', { persist: false });
    render(
      <NewDisplayTabMenu
        onCreateBrowser={vi.fn()}
        onCreateTerminal={vi.fn()}
        onOpenFiles={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'New tab' });
    fireEvent.click(trigger);
    const files = screen.getByRole('menuitem', { name: 'Files' });
    const browser = screen.getByRole('menuitem', { name: 'Browser' });
    await waitFor(() => expect(document.activeElement).toBe(files));

    fireEvent.keyDown(files, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(browser);
    fireEvent.keyDown(browser, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not steal focus back when Files opens its filter', async () => {
    i18nService.setLanguage('en', { persist: false });
    render(
      <div>
        <input aria-label="Files filter" />
        <NewDisplayTabMenu
          onCreateBrowser={vi.fn()}
          onCreateTerminal={vi.fn()}
          onOpenFiles={() => screen.getByRole('textbox', { name: 'Files filter' }).focus()}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Files' }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Files filter' })),
    );
  });
});
