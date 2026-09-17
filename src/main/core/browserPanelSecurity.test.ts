import { describe, expect, it } from 'vitest';

import {
  resolveBrowserGuestShortcut,
  resolveBrowserPanelShortcutAction,
} from '../../shared/browser';
import { isAllowedBrowserPanelUrl, isAllowedMainWindowNavigation } from './browserPanelSecurity';

describe('isAllowedBrowserPanelUrl', () => {
  it('allows only blank and HTTP(S) guest navigation', () => {
    expect(isAllowedBrowserPanelUrl('')).toBe(true);
    expect(isAllowedBrowserPanelUrl('about:blank')).toBe(true);
    expect(isAllowedBrowserPanelUrl('https://example.com/path')).toBe(true);
    expect(isAllowedBrowserPanelUrl('http://localhost:43127')).toBe(true);
    expect(isAllowedBrowserPanelUrl('file:///C:/secrets.txt')).toBe(false);
    expect(isAllowedBrowserPanelUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedBrowserPanelUrl('data:text/html,hello')).toBe(false);
  });
});

describe('isAllowedMainWindowNavigation', () => {
  it('keeps the privileged renderer on its application origin', () => {
    const options = {
      appRoot: 'C:\\app',
      devServerUrl: 'http://localhost:43127',
      isDev: true,
    };
    expect(isAllowedMainWindowNavigation('http://localhost:43127/settings', options)).toBe(true);
    expect(isAllowedMainWindowNavigation('https://example.com/', options)).toBe(false);
  });
});

describe('resolveBrowserGuestShortcut', () => {
  const input = (overrides: Partial<Parameters<typeof resolveBrowserGuestShortcut>[0]>) => ({
    type: 'keyDown',
    key: '',
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...overrides,
  });

  it('maps standard browser navigation and tab shortcuts', () => {
    expect(resolveBrowserGuestShortcut(input({ key: 'l', control: true }))).toBe('focus-address');
    expect(resolveBrowserGuestShortcut(input({ key: 't', meta: true }))).toBeNull();
    expect(resolveBrowserGuestShortcut(input({ key: 't', control: true, shift: true }))).toBe(
      'reopen-tab',
    );
    expect(resolveBrowserGuestShortcut(input({ key: 'w', control: true }))).toBe('close-tab');
    expect(resolveBrowserGuestShortcut(input({ key: 'F5' }))).toBe('reload');
    expect(resolveBrowserGuestShortcut(input({ key: 'ArrowLeft', alt: true }))).toBe('back');
    expect(resolveBrowserGuestShortcut(input({ key: 'Tab', control: true }))).toBe('next-tab');
    expect(resolveBrowserGuestShortcut(input({ key: 'Tab', control: true, shift: true }))).toBe(
      'previous-tab',
    );
  });

  it('resolves configured app shortcuts before browser-local commands', () => {
    const shortcutInput = {
      key: 'k',
      altKey: false,
      ctrlKey: true,
      shiftKey: false,
      metaKey: false,
    };
    expect(
      resolveBrowserPanelShortcutAction(shortcutInput, {
        terminal: 'Ctrl+K',
        browser: 'Ctrl+B',
        'side-chat': 'Ctrl+Alt+S',
        files: 'Ctrl+P',
      }),
    ).toBe('terminal');
    expect(
      resolveBrowserPanelShortcutAction(
        { ...shortcutInput, key: 'b' },
        {
          terminal: 'Ctrl+K',
          browser: 'Ctrl+B',
          'side-chat': 'Ctrl+Alt+S',
          files: 'Ctrl+P',
        },
      ),
    ).toBe('browser');
    expect(
      resolveBrowserPanelShortcutAction(
        { ...shortcutInput, key: 's', altKey: true },
        {
          terminal: 'Ctrl+K',
          browser: 'Ctrl+B',
          'side-chat': 'Ctrl+Alt+S',
          files: 'Ctrl+P',
        },
      ),
    ).toBe('side-chat');
    expect(
      resolveBrowserPanelShortcutAction(
        { ...shortcutInput, key: 'p' },
        {
          terminal: 'Ctrl+K',
          browser: 'Ctrl+B',
          'side-chat': 'Ctrl+Alt+S',
          files: 'Ctrl+P',
        },
      ),
    ).toBe('files');
  });

  it('does not intercept page typing or modified application shortcuts', () => {
    expect(resolveBrowserGuestShortcut(input({ key: 'l' }))).toBeNull();
    expect(resolveBrowserGuestShortcut(input({ key: 'i', control: true, shift: true }))).toBeNull();
    expect(
      resolveBrowserGuestShortcut(input({ type: 'keyUp', key: 'w', control: true })),
    ).toBeNull();
  });
});
