// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import CoworkDisplayPanel from './CoworkDisplayPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CoworkDisplayPanel', () => {
  it('shows its launcher without a tab strip while keeping panel content mounted', () => {
    i18nService.setLanguage('en', { persist: false });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1_000);
    const closePanel = vi.fn();

    render(
      <CoworkDisplayPanel
        activeTabId=""
        isOpen
        onClose={closePanel}
        tabs={[]}
        emptyState={<button type="button">Browser</button>}
      >
        <div data-testid="persistent-panel-content">Persistent content</div>
      </CoworkDisplayPanel>,
    );

    expect(screen.getByRole('button', { name: 'Browser' })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('persistent-panel-content')).toBeTruthy();
    const panel = screen.getByRole('complementary', { name: 'Content preview' });
    expect(panel.classList.contains('bg-background')).toBe(true);
    expect(panel.classList.contains('bg-surface')).toBe(false);
    expect(
      panel.querySelector('.cowork-workspace-header')?.classList.contains('bg-background'),
    ).toBe(true);
    const fullscreenButton = screen.getByRole('button', { name: 'Fill workspace' });
    fireEvent.click(fullscreenButton);
    expect(panel.getAttribute('data-workspace-fullscreen')).toBe('true');
    expect(panel.style.width).toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Restore sidebar size' }));
    expect(panel.getAttribute('data-workspace-fullscreen')).toBe('false');
    expect(panel.style.width).toBe('520px');
    const closeButton = screen.getByRole('button', { name: 'Close sidebar' });
    expect(closeButton.parentElement?.lastElementChild).toBe(closeButton);
    fireEvent.click(screen.getByRole('button', { name: 'Fill workspace' }));
    fireEvent.click(closeButton);
    expect(panel.getAttribute('data-workspace-fullscreen')).toBe('false');
    expect(closePanel).toHaveBeenCalledTimes(1);
  });

  it('renders switchable content tabs in one resizable display region', async () => {
    i18nService.setLanguage('en', { persist: false });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1_000);
    const selectBrowser = vi.fn();
    const closeFile = vi.fn();
    const openBrowserMenu = vi.fn();

    render(
      <div style={{ width: 1_000 }}>
        <CoworkDisplayPanel
          activeTabId="file"
          isOpen
          onClose={vi.fn()}
          tabs={[
            {
              id: 'browser',
              label: 'Browser',
              icon: <span>B</span>,
              onSelect: selectBrowser,
              onContextMenu: openBrowserMenu,
            },
            {
              id: 'file',
              label: 'notes.md',
              icon: <span>F</span>,
              onSelect: vi.fn(),
              onClose: closeFile,
            },
          ]}
        >
          <div>Preview content</div>
        </CoworkDisplayPanel>
      </div>,
    );

    expect(screen.getByRole('complementary', { name: 'Content preview' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'notes.md' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Browser' }));
    expect(selectBrowser).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Browser' }), {
      clientX: 48,
      clientY: 72,
    });
    expect(openBrowserMenu).toHaveBeenCalledWith({ x: 48, y: 72 });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'notes.md' }), { key: 'ArrowLeft' });
    expect(selectBrowser).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Browser' })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close: notes.md' }));
    expect(closeFile).toHaveBeenCalledTimes(1);

    const separator = screen.getByRole('separator', { name: 'Drag to resize panels' });
    expect(separator.getAttribute('aria-valuenow')).toBe('520');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('496');
  });

  it('clamps its width when the containing layout changes without a window resize', () => {
    i18nService.setLanguage('en', { persist: false });
    let availableWidth = 1_000;
    let resizeContainer: () => void = () => undefined;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => availableWidth);
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        constructor(callback: () => void) {
          resizeContainer = callback;
        }
        observe() {}
        disconnect() {}
      },
    );

    render(
      <div>
        <CoworkDisplayPanel
          activeTabId="browser"
          isOpen
          onClose={vi.fn()}
          tabs={[
            {
              id: 'browser',
              label: 'Browser',
              icon: <span>B</span>,
              onSelect: vi.fn(),
            },
          ]}
        >
          <div>Browser content</div>
        </CoworkDisplayPanel>
      </div>,
    );

    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('520');
    availableWidth = 700;
    act(() => resizeContainer());
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('360');
  });

  it('renders web pages, files, and the singleton plan as peer tabs', () => {
    i18nService.setLanguage('en', { persist: false });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1_000);
    const addPage = vi.fn();
    const labels = [
      'Page one',
      'Page two',
      'Page three',
      'notes.md',
      'design.tsx',
      'Implementation plan',
    ];

    render(
      <CoworkDisplayPanel
        activeTabId="plan"
        isOpen
        onClose={vi.fn()}
        tabs={labels.map((label, index) => ({
          id: index === labels.length - 1 ? 'plan' : `tab-${index}`,
          label,
          icon: <span aria-hidden="true">T</span>,
          onSelect: vi.fn(),
        }))}
        actions={
          <button type="button" onClick={addPage} aria-label="New page">
            +
          </button>
        }
      >
        <div>Plan content</div>
      </CoworkDisplayPanel>,
    );

    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.getAllByTestId('display-tab-divider')).toHaveLength(5);
    expect(screen.getByRole('tab', { name: 'Implementation plan' })).toBeTruthy();
    const tabCluster = screen.getByTestId('display-tab-cluster');
    expect(tabCluster.parentElement?.classList.contains('cowork-workspace-header')).toBe(true);
    expect(tabCluster.classList.contains('h-full')).toBe(true);
    expect(
      screen
        .getByRole('tab', { name: 'Implementation plan' })
        .parentElement?.classList.contains('h-full'),
    ).toBe(true);
    expect(
      tabCluster.lastElementChild?.contains(screen.getByRole('button', { name: 'New page' })),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'New page' }));
    expect(addPage).toHaveBeenCalledTimes(1);
  });
});
