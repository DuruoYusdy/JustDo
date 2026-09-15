// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import BrowserPanel from './BrowserPanel';

vi.mock('@/features/cowork/components/composer/LocalSpeechInputButton', () => ({
  LocalSpeechInputButton: () => null,
}));

type PanelOpenTabListener = (event: { url: string; errorCode?: 'post-navigation-blocked' }) => void;

let panelOpenTabListener: PanelOpenTabListener | null = null;
let nextId = 0;
const loadUrl = vi.fn(async function (this: HTMLElement, url: string) {
  this.setAttribute('src', url);
});
const reload = vi.fn();
const setAudioMuted = vi.fn();
const findInPage = vi.fn(() => 1);
const stopFind = vi.fn();
const printPage = vi.fn((_options, callback) => callback?.(true));
const setZoomFactor = vi.fn();
const openDevTools = vi.fn();
const guestSend = vi.fn(function (this: HTMLElement, channel: string, requestId?: string) {
  if (channel !== 'justdo-browser-inspect') return;
  const event = new Event('ipc-message');
  Object.assign(event, {
    channel: 'justdo-browser-inspect-result',
    args: [requestId, [inspectedElement]],
  });
  this.dispatchEvent(event);
});
const listImportSources = vi.fn().mockResolvedValue({
  success: true,
  sources: [{ id: 'Default', browser: 'chrome', name: 'Google Chrome · Profile 1' }],
});
const importData = vi.fn().mockResolvedValue({
  success: true,
  imported: { passwords: 2, cookies: 3, history: 4 },
  skippedAppBound: { passwords: 0, cookies: 0 },
});
const getClearDataSummary = vi.fn().mockResolvedValue({
  success: true,
  summary: {
    history: 12,
    latestHistoryOrigin: 'example.com',
    cookieSites: 3,
    downloads: 2,
    autofill: 1,
  },
});
const clearBrowsingData = vi.fn().mockResolvedValue({ success: true });
const inspectedElement = {
  tag: 'a',
  id: 'docs',
  classes: ['link'],
  role: 'link',
  name: 'Documentation',
  rect: { x: 20, y: 20, width: 100, height: 24 },
  focusable: true,
  cssPath: 'main > a#docs',
};

const defineWebviewMethod = (name: string, value: unknown) => {
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    writable: true,
    value,
  });
};

function BrowserPanelHarness({
  isOpen = true,
  onRequestBrowserSettings,
}: {
  isOpen?: boolean;
  onRequestBrowserSettings?: (page?: 'history' | 'downloads') => void;
}) {
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  return (
    <BrowserPanel
      draftKey="__home__"
      isOpen={isOpen}
      width={520}
      activeTargetId={activeTargetId}
      onClose={vi.fn()}
      onWidthChange={vi.fn()}
      onActiveTargetChange={setActiveTargetId}
      onAddAnnotation={() => true}
      onRequestBrowserSettings={onRequestBrowserSettings}
    />
  );
}

describe('BrowserPanel embedded webview', () => {
  beforeEach(() => {
    panelOpenTabListener = null;
    loadUrl.mockClear();
    reload.mockClear();
    setAudioMuted.mockClear();
    findInPage.mockClear();
    stopFind.mockClear();
    printPage.mockClear();
    setZoomFactor.mockClear();
    openDevTools.mockClear();
    guestSend.mockClear();
    listImportSources.mockClear();
    importData.mockClear();
    getClearDataSummary.mockClear();
    clearBrowsingData.mockClear();
    i18nService.setLanguage('en', { persist: false });

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `browser-tab-${++nextId}`),
    });
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    defineWebviewMethod('canGoBack', () => false);
    defineWebviewMethod('canGoForward', () => false);
    defineWebviewMethod('getTitle', () => '');
    defineWebviewMethod('getURL', function (this: HTMLElement) {
      return this.getAttribute('src') ?? 'about:blank';
    });
    defineWebviewMethod('goBack', vi.fn());
    defineWebviewMethod('goForward', vi.fn());
    defineWebviewMethod('loadURL', loadUrl);
    defineWebviewMethod('reload', reload);
    defineWebviewMethod('isAudioMuted', () => false);
    defineWebviewMethod('setAudioMuted', setAudioMuted);
    defineWebviewMethod('findInPage', findInPage);
    defineWebviewMethod('stopFind', stopFind);
    defineWebviewMethod('print', printPage);
    defineWebviewMethod('getZoomFactor', () => 1);
    defineWebviewMethod('setZoomFactor', setZoomFactor);
    defineWebviewMethod('openDevTools', openDevTools);
    defineWebviewMethod('send', guestSend);
    defineWebviewMethod('capturePage', vi.fn());

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        browser: {
          onPanelOpenTab: (listener: PanelOpenTabListener) => {
            panelOpenTabListener = listener;
            return () => {
              if (panelOpenTabListener === listener) panelOpenTabListener = null;
            };
          },
          listImportSources,
          importData,
          getClearDataSummary,
          clearBrowsingData,
        },
        shell: {
          openExternal: vi.fn().mockResolvedValue({ success: true }),
        },
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const name of [
      'canGoBack',
      'canGoForward',
      'getTitle',
      'getURL',
      'goBack',
      'goForward',
      'loadURL',
      'reload',
      'isAudioMuted',
      'setAudioMuted',
      'findInPage',
      'stopFind',
      'print',
      'getZoomFactor',
      'setZoomFactor',
      'openDevTools',
      'send',
      'capturePage',
    ]) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
    delete (window as unknown as { electron?: unknown }).electron;
  });

  it('shows a browser-style start page for a blank tab and focuses the address bar', () => {
    const { container } = render(<BrowserPanelHarness />);

    expect(screen.getByText('Start browsing')).toBeTruthy();
    expect(screen.getByText('Search or enter an address to open a page')).toBeTruthy();
    const activeTab = container.querySelector('[data-browser-tab-id]');
    expect(activeTab?.textContent).toContain('New tab');
    expect(activeTab?.textContent).not.toContain('about:blank');

    fireEvent.click(screen.getByLabelText('Focus the address bar'));
    expect(document.activeElement).toBe(screen.getByLabelText('Browser address'));
  });

  it('does not read guest zoom until the current webview emits dom-ready', async () => {
    const getZoomFactor = vi.fn(() => 1.25);
    defineWebviewMethod('getZoomFactor', getZoomFactor);
    const { container } = render(<BrowserPanelHarness />);
    const webview = container.querySelector('webview')!;

    expect(getZoomFactor).not.toHaveBeenCalled();

    fireEvent(webview, new Event('dom-ready'));

    await waitFor(() => expect(getZoomFactor).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByLabelText('More browser options'));
    expect(screen.getAllByRole('button', { name: 'Reset zoom' })[0]?.textContent).toBe('125%');
  });

  it('tolerates a webview being detached while synchronizing its zoom', async () => {
    const getZoomFactor = vi.fn(() => {
      throw new Error('The WebView must be attached to the DOM');
    });
    defineWebviewMethod('getZoomFactor', getZoomFactor);
    const { container } = render(<BrowserPanelHarness />);
    const webview = container.querySelector('webview')!;

    fireEvent(webview, new Event('dom-ready'));

    await waitFor(() => expect(getZoomFactor).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByLabelText('More browser options'));
    expect(screen.getAllByRole('button', { name: 'Reset zoom' })[0]?.textContent).toBe('100%');
  });

  it('keeps interaction on the live guest and navigates it directly', async () => {
    const { container } = render(<BrowserPanelHarness />);
    const webview = container.querySelector('webview');
    const canvas = container.querySelector('canvas');
    expect(webview).not.toBeNull();
    expect(canvas).toBeNull();

    fireEvent.change(screen.getByLabelText('Browser address'), {
      target: { value: 'example.com/path' },
    });
    fireEvent.submit(screen.getByLabelText('Browser address').closest('form')!);

    await waitFor(() => expect(loadUrl).toHaveBeenCalledWith('https://example.com/path'));
    expect(loadUrl.mock.instances[0]).toBe(webview);
  });

  it('searches non-address text with the configured default search engine', async () => {
    render(<BrowserPanelHarness />);

    fireEvent.change(screen.getByLabelText('Browser address'), {
      target: { value: 'electron browser panel' },
    });
    fireEvent.submit(screen.getByLabelText('Browser address').closest('form')!);

    await waitFor(() =>
      expect(loadUrl).toHaveBeenCalledWith('https://www.baidu.com/s?wd=electron+browser+panel'),
    );
  });

  it('retains the current URL when the panel is hidden and mounted again', async () => {
    const firstRender = render(<BrowserPanelHarness />);
    const firstWebview = firstRender.container.querySelector('webview')!;
    const navigated = new Event('did-navigate');
    Object.assign(navigated, { url: 'https://example.com/retained' });
    firstWebview.dispatchEvent(navigated);

    await waitFor(() =>
      expect((screen.getByLabelText('Browser address') as HTMLInputElement).value).toBe(
        'https://example.com/retained',
      ),
    );
    firstRender.unmount();

    const secondRender = render(<BrowserPanelHarness />);
    const restoredWebview = secondRender.container.querySelector('webview')!;
    expect(restoredWebview.getAttribute('src')).toBe('https://example.com/retained');

    const bootstrapNavigation = new Event('did-navigate');
    Object.assign(bootstrapNavigation, { url: 'about:blank' });
    restoredWebview.dispatchEvent(bootstrapNavigation);

    expect((screen.getByLabelText('Browser address') as HTMLInputElement).value).toBe(
      'https://example.com/retained',
    );
  });

  it('keeps the live guest mounted while the panel is hidden', () => {
    const view = render(<BrowserPanelHarness />);
    const webview = view.container.querySelector('webview');

    view.rerender(<BrowserPanelHarness isOpen={false} />);
    expect(view.container.querySelector('webview')).toBe(webview);
    expect(view.container.querySelector('aside')?.className).toContain('hidden');

    view.rerender(<BrowserPanelHarness />);
    expect(view.container.querySelector('webview')).toBe(webview);
  });

  it('does not overwrite an address being edited when page metadata changes', async () => {
    const { container } = render(<BrowserPanelHarness />);
    const address = screen.getByLabelText('Browser address');
    fireEvent.change(address, { target: { value: 'typed.example/path' } });

    const webview = container.querySelector('webview')!;
    const titleEvent = new Event('page-title-updated');
    Object.assign(titleEvent, { title: 'Late title' });
    webview.dispatchEvent(titleEvent);
    const faviconEvent = new Event('page-favicon-updated');
    Object.assign(faviconEvent, { favicons: ['https://example.com/favicon.ico'] });
    webview.dispatchEvent(faviconEvent);

    expect((address as HTMLInputElement).value).toBe('typed.example/path');

    const navigationEvent = new Event('did-navigate');
    Object.assign(navigationEvent, { url: 'https://clicked.example/page' });
    webview.dispatchEvent(navigationEvent);
    await waitFor(() =>
      expect((address as HTMLInputElement).value).toBe('https://clicked.example/page'),
    );
  });

  it('retains a tab load error through did-stop-loading and clears it on retry', async () => {
    const { container } = render(<BrowserPanelHarness />);
    const webview = container.querySelector('webview')!;
    const failed = new Event('did-fail-load');
    Object.assign(failed, {
      errorCode: -105,
      errorDescription: 'Name not resolved',
      isMainFrame: true,
    });
    webview.dispatchEvent(failed);
    webview.dispatchEvent(new Event('did-stop-loading'));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Name not resolved');

    webview.dispatchEvent(new Event('did-start-loading'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('enables popup events and routes target=_blank into a managed panel tab', async () => {
    const { container } = render(<BrowserPanelHarness />);
    expect(container.querySelectorAll('webview')).toHaveLength(1);

    fireEvent.click(screen.getByLabelText('New tab'));
    await waitFor(() => expect(container.querySelectorAll('webview')).toHaveLength(2));

    expect(panelOpenTabListener).not.toBeNull();
    panelOpenTabListener?.({ url: 'https://popup.example/path' });
    await waitFor(() => expect(container.querySelectorAll('webview')).toHaveLength(3));

    const webviews = [...container.querySelectorAll('webview')];
    expect(
      webviews.some(webview => webview.getAttribute('src') === 'https://popup.example/path'),
    ).toBe(true);
    for (const webview of webviews) {
      expect(webview.getAttribute('allowpopups')).toBe('true');
      expect(webview.getAttribute('partition')).toBe('persist:justdo-browser');
    }
  });

  it('reports a blocked target=_blank form submission without opening a GET tab', async () => {
    const { container } = render(<BrowserPanelHarness />);
    const initialTabCount = container.querySelectorAll('webview').length;

    panelOpenTabListener?.({
      url: 'https://example.com/submit',
      errorCode: 'post-navigation-blocked',
    });

    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'This page tried to submit a form in a new tab. The unsupported request was blocked.',
    );
    expect(container.querySelectorAll('webview')).toHaveLength(initialTabCount);
  });

  it('opens an editable comment box after locking an inspected element', async () => {
    const { container } = render(<BrowserPanelHarness />);
    fireEvent.click(screen.getByLabelText('Add comment'));
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.className).toContain('browser-element-annotation-cursor');
    fireEvent.click(canvas!, { clientX: 24, clientY: 24 });

    expect(await screen.findByRole('textbox', { name: 'Add a comment…' })).toBeTruthy();
    expect(screen.queryByText('a#docs.link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand HTML element details' })).toBeTruthy();
    const composer = screen.getByTestId('browser-annotation-composer');
    expect(composer.style.top).toBe('54px');
    expect(composer.style.bottom).toBe('');
  });

  it('describes icon-only tools on hover', async () => {
    render(<BrowserPanelHarness />);
    const inspectButton = screen.getByLabelText('Add comment');

    expect(screen.queryByLabelText('Interact with page')).toBeNull();
    expect(inspectButton.className).toContain('bg-transparent');
    expect(inspectButton.className).not.toContain('bg-primary-muted');
    expect(screen.getByTestId('browser-inspect-plus')).toBeTruthy();

    fireEvent.mouseEnter(inspectButton.parentElement!);

    expect((await screen.findByRole('tooltip')).textContent).toBe('Add comment');

    fireEvent.click(inspectButton);

    expect(inspectButton.getAttribute('aria-pressed')).toBe('true');
    expect(inspectButton.getAttribute('aria-label')).toBe('Stop adding comments');
    expect(inspectButton.className).toContain('ring-primary/55');
    expect(inspectButton.className).not.toContain('bg-primary-muted');
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(inspectButton);

    expect(inspectButton.getAttribute('aria-pressed')).toBe('false');
    expect(inspectButton.getAttribute('aria-label')).toBe('Add comment');
    expect(inspectButton.className).not.toContain('ring-primary/55');
  });

  it('keeps annotation tools in the address row without a redundant title bar', () => {
    render(<BrowserPanelHarness />);
    const address = screen.getByLabelText('Browser address');
    const inspectButton = screen.getByLabelText('Add comment');
    const toolGroup = screen.getByTestId('browser-annotation-tool-group');

    expect(inspectButton.closest('form')).toBe(address.closest('form'));
    expect(toolGroup.className).toContain('border-border/70');
    expect(toolGroup.querySelectorAll('button')).toHaveLength(5);
    expect(toolGroup.querySelector('.h-px, .w-px')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Browser' })).toBeNull();
    expect(screen.getByLabelText('Close browser panel')).toBeTruthy();
  });

  it('opens a browser-style overflow menu and wires supported page actions', async () => {
    const onRequestBrowserSettings = vi.fn();
    const { container } = render(
      <BrowserPanelHarness onRequestBrowserSettings={onRequestBrowserSettings} />,
    );
    fireEvent(container.querySelector('webview')!, new Event('dom-ready'));

    fireEvent.click(screen.getByLabelText('More browser options'));
    const menu = screen.getByRole('menu', { name: 'Browser menu' });
    expect(menu).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Find in page' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Print' })).toBeTruthy();
    expect(screen.getByText('Zoom')).toBeTruthy();
    expect(
      screen
        .getByRole('menuitem', { name: 'Import cookies and passwords' })
        .hasAttribute('disabled'),
    ).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'History' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'Downloads' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(screen.queryByRole('menuitem', { name: 'Passwords and autofill' })).toBeNull();

    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(setZoomFactor).toHaveBeenCalledWith(1.1);
    expect(screen.getByText('110%')).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Find in page' }));
    const findInput = screen.getByLabelText('Find in page');
    fireEvent.change(findInput, { target: { value: 'docs' } });
    await waitFor(() => expect(findInPage).toHaveBeenCalledWith('docs', expect.any(Object)));
    fireEvent.click(screen.getByLabelText('Close find'));
    expect(stopFind).toHaveBeenCalledWith('clearSelection');

    fireEvent.click(screen.getByLabelText('More browser options'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show device toolbar' }));
    expect(openDevTools).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText('More browser options'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'History' }));
    expect(onRequestBrowserSettings).toHaveBeenCalledWith('history');

    fireEvent.click(screen.getByLabelText('More browser options'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Downloads' }));
    expect(onRequestBrowserSettings).toHaveBeenCalledWith('downloads');

    fireEvent.click(screen.getByLabelText('More browser options'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Browser settings' }));
    expect(onRequestBrowserSettings).toHaveBeenLastCalledWith();
  });

  it('opens a guarded Chrome data import dialog from the overflow menu', async () => {
    const { container } = render(<BrowserPanelHarness />);
    fireEvent(container.querySelector('webview')!, new Event('dom-ready'));

    fireEvent.click(screen.getByLabelText('More browser options'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import cookies and passwords' }));

    expect(screen.getByRole('dialog', { name: 'Import from browser' })).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByLabelText('Import source') as HTMLSelectElement).value).toBe('Default'),
    );
    expect(
      screen.getByRole('switch', { name: 'Saved passwords' }).getAttribute('aria-checked'),
    ).toBe('true');
    const cookieSwitch = screen.getByRole('switch', { name: 'Cookies' });
    expect(cookieSwitch.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByText(
        'Sign-in cookies from recent Chrome versions are usually protected, so this is off by default',
      ),
    ).toBeTruthy();
    const importButton = screen.getByRole('button', { name: 'Import' });
    expect(importButton.hasAttribute('disabled')).toBe(true);

    fireEvent.click(cookieSwitch);
    fireEvent.click(
      screen.getByLabelText(
        'I understand and allow the app to read and import the selected Chrome data locally',
      ),
    );
    expect(importButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(importButton);
    await waitFor(() => expect(importData).toHaveBeenCalledOnce());
    expect(importData).toHaveBeenCalledWith({
      sourceId: 'Default',
      passwords: true,
      cookies: true,
      history: true,
      approved: true,
    });
    expect(reload).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Import from browser' })).toBeNull(),
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Imported: 2 passwords, 3 cookies, and 4 history entries.',
    );
    fireEvent.click(screen.getByLabelText('Dismiss browser notification'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('recovers when Chrome profile discovery rejects', async () => {
    listImportSources.mockRejectedValueOnce(new Error('native path SHOULD_NOT_RENDER'));
    render(<BrowserPanelHarness />);

    fireEvent.click(screen.getByLabelText('More browser options'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import cookies and passwords' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Unable to read the Chrome profile',
    );
    expect(screen.queryByText(/SHOULD_NOT_RENDER/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Import' }).hasAttribute('disabled')).toBe(true);
  });

  it('requires confirmation in trusted host UI before filling a saved credential', async () => {
    const { container } = render(<BrowserPanelHarness />);
    const webview = container.querySelector('webview')!;
    const offer = new Event('ipc-message');
    Object.assign(offer, { channel: 'justdo-browser-credentials:offer', args: [] });

    fireEvent(webview, offer);

    expect(
      await screen.findByText('Use the sign-in information saved for this site?'),
    ).toBeTruthy();
    expect(guestSend).not.toHaveBeenCalledWith('justdo-browser-credentials:fill');
    fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
    expect(guestSend).toHaveBeenCalledWith('justdo-browser-credentials:fill');
    expect(screen.queryByText('Use the sign-in information saved for this site?')).toBeNull();
  });

  it('clears selected browser data through the privileged browser service', async () => {
    const { container } = render(<BrowserPanelHarness />);
    fireEvent(container.querySelector('webview')!, new Event('dom-ready'));

    fireEvent.click(screen.getByLabelText('More browser options'));
    const clearMenuItem = screen.getByRole('menuitem', { name: 'Clear browsing data' });
    expect(clearMenuItem.hasAttribute('disabled')).toBe(false);
    fireEvent.click(clearMenuItem);

    expect(screen.getByRole('dialog', { name: 'Clear browsing data' })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('12 entries, most recently from example.com')).toBeTruthy(),
    );
    expect(screen.getByText('Sites currently storing cookies: 3')).toBeTruthy();
    expect(screen.getByText(/Chromium can only clear all cookies/)).toBeTruthy();
    expect(screen.queryByLabelText('Site settings')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete data' }));
    await waitFor(() => expect(clearBrowsingData).toHaveBeenCalledOnce());
    expect(clearBrowsingData).toHaveBeenCalledWith({
      range: 'hour',
      selection: {
        history: true,
        cookiesAndSiteData: true,
        cache: true,
        downloads: true,
        autofill: false,
      },
    });
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Selected browsing data cleared');
  });

  it('states clearly when protected Chrome cookies did not transfer sign-in state', async () => {
    importData.mockResolvedValueOnce({
      success: true,
      imported: { passwords: 4, cookies: 0, history: 4897 },
      skippedAppBound: { passwords: 0, cookies: 3120 },
    });
    render(<BrowserPanelHarness />);

    fireEvent.click(screen.getByLabelText('More browser options'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import cookies and passwords' }));
    await waitFor(() => expect(screen.getByLabelText('Import source')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch', { name: 'Cookies' }));
    fireEvent.click(
      screen.getByLabelText(
        'I understand and allow the app to read and import the selected Chrome data locally',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    const notice = await screen.findByRole('status');
    expect(notice.textContent).toContain(
      'Imported: 4 passwords, 0 cookies, and 4897 history entries.',
    );
    expect(notice.textContent).toContain('Chrome sign-in state was not transferred.');
    expect(notice.textContent).toContain(
      '3120 cookies protected by Chrome app-bound encryption could not be transferred.',
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps import failures bounded and does not render native command details', async () => {
    importData.mockResolvedValueOnce({
      success: false,
      errorCode: 'decrypt-failed',
      error: 'Command failed with encrypted payload SHOULD_NOT_RENDER',
    });
    render(<BrowserPanelHarness />);

    fireEvent.click(screen.getByLabelText('More browser options'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import cookies and passwords' }));
    const dialog = screen.getByRole('dialog', { name: 'Import from browser' });
    await waitFor(() => expect(screen.getByLabelText('Import source')).toBeTruthy());
    fireEvent.click(
      screen.getByLabelText(
        'I understand and allow the app to read and import the selected Chrome data locally',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Unable to decrypt Chrome data. Make sure Chrome belongs to the current Windows user.',
    );
    expect(screen.queryByText(/SHOULD_NOT_RENDER/)).toBeNull();
    expect(dialog.className).toContain('max-h-[calc(100vh-2rem)]');
    expect(dialog.querySelector('.overflow-y-auto')).toBeTruthy();
  });

  it('combines drawing modes into a remembered annotation tool picker', () => {
    render(<BrowserPanelHarness />);
    const penTool = screen.getByLabelText('Draw annotation');
    expect(penTool).toBeTruthy();
    expect(screen.queryByLabelText('Rectangle annotation')).toBeNull();

    fireEvent.click(penTool);
    expect(penTool.getAttribute('aria-pressed')).toBe('true');
    expect(penTool.getAttribute('aria-label')).toBe('Stop drawing');
    expect(penTool.className).toContain('ring-primary/55');

    fireEvent.click(penTool);
    expect(penTool.getAttribute('aria-pressed')).toBe('false');
    expect(penTool.getAttribute('aria-label')).toBe('Draw annotation');

    fireEvent.click(screen.getByLabelText('Switch annotation tool'));
    const rectangleOption = screen.getByRole('menuitemradio', {
      name: 'Rectangle annotation',
    });
    fireEvent.click(rectangleOption);

    const rectangleTool = screen.getByLabelText('Stop rectangle annotation');
    expect(rectangleTool.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('menu', { name: 'Choose annotation tool' })).toBeNull();
  });

  it('shows the page favicon next to its tab title', async () => {
    const { container } = render(<BrowserPanelHarness />);
    const webview = container.querySelector('webview')!;
    const titleEvent = new Event('page-title-updated');
    Object.assign(titleEvent, { title: 'Example Docs' });
    webview.dispatchEvent(titleEvent);
    const faviconEvent = new Event('page-favicon-updated');
    Object.assign(faviconEvent, { favicons: ['https://example.com/favicon.ico'] });
    webview.dispatchEvent(faviconEvent);

    const tab = container.querySelector('[data-browser-tab-id]')!;
    await waitFor(() =>
      expect(tab.querySelector('img')?.getAttribute('src')).toBe('https://example.com/favicon.ico'),
    );
    expect(tab.textContent).toContain('Example Docs');
  });

  it('offers tab management actions from the tab context menu', async () => {
    const { container } = render(<BrowserPanelHarness />);
    const tab = container.querySelector('[data-browser-tab-id]')!;
    const initialTabCount = container.querySelectorAll('webview').length;

    fireEvent.contextMenu(tab, { clientX: 40, clientY: 40 });
    expect(screen.getByRole('menu', { name: 'Tab menu' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate tab' }));
    await waitFor(() =>
      expect(container.querySelectorAll('webview')).toHaveLength(initialTabCount + 1),
    );

    fireEvent.contextMenu(tab, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const renameInput = screen.getByLabelText('Rename tab');
    fireEvent.change(renameInput, { target: { value: 'Research' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });
    expect(tab.textContent).toContain('Research');

    fireEvent.contextMenu(tab, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mute tab' }));
    expect(setAudioMuted).toHaveBeenCalledWith(true);
  });
});
