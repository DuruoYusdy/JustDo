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
  it('keeps automatic width at half the container until the user resizes it', () => {
    let availableWidth = 1_000;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => availableWidth);
    const onWidthChange = vi.fn();
    const panel = (width: number) => (
      <CoworkDisplayPanel
        activeTabId=""
        isOpen
        onClose={vi.fn()}
        onWidthChange={onWidthChange}
        tabs={[]}
        width={width}
      >
        <div>Browser content</div>
      </CoworkDisplayPanel>
    );
    const view = render(panel(0));
    expect(screen.getByRole('complementary').style.width).toBe('500px');

    availableWidth = 1_600;
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('complementary').style.width).toBe('800px');
    expect(onWidthChange).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(onWidthChange).toHaveBeenLastCalledWith(776);
    view.rerender(panel(776));
    availableWidth = 1_800;
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('complementary').style.width).toBe('776px');
  });

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
    expect(openBrowserMenu).toHaveBeenCalledWith(
      { x: 48, y: 72 },
      expect.objectContaining({ canCloseOthers: true, canCloseRight: true }),
    );
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

  it('renders the width supplied by the owning session', () => {
    i18nService.setLanguage('en', { persist: false });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1_000);
    const view = render(
      <CoworkDisplayPanel
        activeTabId="file"
        isOpen
        onClose={vi.fn()}
        tabs={[]}
        width={600}
      >
        <div>Preview content</div>
      </CoworkDisplayPanel>,
    );

    expect(screen.getByRole('complementary').style.width).toBe('600px');
    view.rerender(
      <CoworkDisplayPanel
        activeTabId="file"
        isOpen
        onClose={vi.fn()}
        tabs={[]}
        width={440}
      >
        <div>Preview content</div>
      </CoworkDisplayPanel>,
    );
    expect(screen.getByRole('complementary').style.width).toBe('440px');
  });

  it('offers close, close-other, and close-right actions for display tabs', async () => {
    i18nService.setLanguage('en', { persist: false });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1_000);
    const selectMiddle = vi.fn();
    const closeLeft = vi.fn();
    const closeMiddle = vi.fn();
    const closeRight = vi.fn();
    const openSystemTerminal = vi.fn();

    render(
      <CoworkDisplayPanel
        activeTabId="middle"
        isOpen
        onClose={vi.fn()}
        tabs={[
          {
            id: 'left',
            label: 'Left',
            icon: <span>L</span>,
            onSelect: vi.fn(),
            onClose: closeLeft,
          },
          {
            id: 'middle',
            label: 'Middle',
            icon: <span>M</span>,
            onSelect: selectMiddle,
            onClose: closeMiddle,
            contextMenuItems: [
              {
                id: 'open-system-terminal',
                label: 'Open system terminal',
                onSelect: openSystemTerminal,
              },
            ],
          },
          {
            id: 'right',
            label: 'Right',
            icon: <span>R</span>,
            onSelect: vi.fn(),
            onClose: closeRight,
          },
        ]}
      >
        <div>Content</div>
      </CoworkDisplayPanel>,
    );

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Middle' }), {
      clientX: 40,
      clientY: 50,
    });
    const menu = screen.getByRole('menu', { name: 'Tab menu' });
    const openSystemTerminalItem = screen.getByRole('menuitem', {
      name: 'Open system terminal',
    });
    expect(menu.classList.contains('w-72')).toBe(true);
    expect(
      openSystemTerminalItem.querySelector('span')?.classList.contains('whitespace-nowrap'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open system terminal' }));
    expect(openSystemTerminal).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Middle' })),
    );

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Middle' }), {
      clientX: 40,
      clientY: 50,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tabs to the right' }));
    await waitFor(() => expect(closeRight).toHaveBeenCalledTimes(1));

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Middle' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close other tabs' }));
    await waitFor(() => {
      expect(selectMiddle).toHaveBeenCalledTimes(1);
      expect(closeLeft).toHaveBeenCalledTimes(1);
      expect(closeRight).toHaveBeenCalledTimes(2);
    });

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Middle' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }));
    await waitFor(() => expect(closeMiddle).toHaveBeenCalledTimes(1));
  });

  it('stops a bulk close when a tab rejects its close transition', async () => {
    i18nService.setLanguage('en', { persist: false });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1_000);
    const rejectClose = vi.fn().mockResolvedValue(false);
    const laterClose = vi.fn();

    render(
      <CoworkDisplayPanel
        activeTabId="target"
        isOpen
        onClose={vi.fn()}
        tabs={[
          {
            id: 'target',
            label: 'Target',
            icon: <span>T</span>,
            onSelect: vi.fn(),
            onClose: vi.fn(),
          },
          {
            id: 'dirty-file',
            label: 'Dirty file',
            icon: <span>D</span>,
            onSelect: vi.fn(),
            onClose: rejectClose,
          },
          {
            id: 'later',
            label: 'Later',
            icon: <span>L</span>,
            onSelect: vi.fn(),
            onClose: laterClose,
          },
        ]}
      >
        <div>Content</div>
      </CoworkDisplayPanel>,
    );

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Target' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close tabs to the right' }));

    await waitFor(() => expect(rejectClose).toHaveBeenCalledTimes(1));
    expect(laterClose).not.toHaveBeenCalled();
  });

  it('dismisses a portaled tab menu when the display panel is hidden', () => {
    i18nService.setLanguage('en', { persist: false });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1_000);
    const tabs = [
      {
        id: 'file',
        label: 'notes.md',
        icon: <span>F</span>,
        onSelect: vi.fn(),
        onClose: vi.fn(),
      },
    ];
    const view = render(
      <CoworkDisplayPanel activeTabId="file" isOpen onClose={vi.fn()} tabs={tabs}>
        <div>Content</div>
      </CoworkDisplayPanel>,
    );

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'notes.md' }));
    expect(screen.getByRole('menu', { name: 'Tab menu' })).toBeTruthy();

    view.rerender(
      <CoworkDisplayPanel activeTabId="file" isOpen={false} onClose={vi.fn()} tabs={tabs}>
        <div>Content</div>
      </CoworkDisplayPanel>,
    );
    expect(screen.queryByRole('menu', { name: 'Tab menu' })).toBeNull();
  });

  it('docks the workspace tree beside preview content without adding a tab', async () => {
    i18nService.setLanguage('en', { persist: false });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1_000);

    render(
      <CoworkDisplayPanel
        activeTabId=""
        isOpen
        onClose={vi.fn()}
        tabs={[]}
        emptyState={<div>Open a file</div>}
        sidePanel={<div>Workspace tree</div>}
      >
        <div>Preview content</div>
      </CoworkDisplayPanel>,
    );

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Open a file')).toBeTruthy();
    expect(screen.getByText('Workspace tree')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('640'),
    );
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
