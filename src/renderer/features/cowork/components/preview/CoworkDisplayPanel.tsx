import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '@/services/i18n';
import RightSidebarIcon from '@/shared/components/icons/RightSidebarIcon';
import WorkspaceFullscreenIcon from '@/shared/components/icons/WorkspaceFullscreenIcon';

export interface CoworkDisplayTab {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClose?: () => void;
  onContextMenu?: (position: { x: number; y: number }) => void;
  onSelect: () => void;
}

interface CoworkDisplayPanelProps {
  activeTabId: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  emptyState?: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  tabs: CoworkDisplayTab[];
}

const DISPLAY_PANEL_DEFAULT_WIDTH = 520;
const DISPLAY_PANEL_MIN_WIDTH = 360;
const CHAT_PANEL_MIN_WIDTH = 360;

const getDisplayPanelMaxWidth = (element: HTMLElement | null): number => {
  const availableWidth = element?.parentElement?.clientWidth ?? window.innerWidth;
  return Math.max(DISPLAY_PANEL_MIN_WIDTH, availableWidth - CHAT_PANEL_MIN_WIDTH);
};

const CoworkDisplayPanel: React.FC<CoworkDisplayPanelProps> = ({
  activeTabId,
  actions,
  children,
  emptyState,
  isOpen,
  onClose,
  tabs,
}) => {
  const [width, setWidth] = useState(DISPLAY_PANEL_DEFAULT_WIDTH);
  const [isWorkspaceFullscreen, setIsWorkspaceFullscreen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const clampWidth = useCallback((nextWidth: number) => {
    return Math.min(
      Math.max(nextWidth, DISPLAY_PANEL_MIN_WIDTH),
      getDisplayPanelMaxWidth(panelRef.current),
    );
  }, []);

  useEffect(() => {
    const resize = () => setWidth(current => clampWidth(current));
    resize();
    const container = panelRef.current?.parentElement;
    const observer =
      container && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (container) observer?.observe(container);
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [clampWidth]);

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, tabIndex: number) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !tabs.length) return;
      event.preventDefault();
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : event.key === 'ArrowLeft'
              ? (tabIndex - 1 + tabs.length) % tabs.length
              : (tabIndex + 1) % tabs.length;
      const nextTab = tabs[nextIndex];
      if (!nextTab) return;
      nextTab.onSelect();
      requestAnimationFrame(() => tabButtonRefs.current.get(nextTab.id)?.focus());
    },
    [tabs],
  );

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
    },
    [],
  );

  const beginResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const right = panelRef.current?.getBoundingClientRect().right ?? window.innerWidth;
      event.preventDefault();

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setWidth(clampWidth(right - moveEvent.clientX));
      };
      const cleanupResize = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', cleanupResize);
        resizeCleanupRef.current = null;
      };

      resizeCleanupRef.current?.();
      resizeCleanupRef.current = cleanupResize;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', cleanupResize);
    },
    [clampWidth],
  );

  return (
    <aside
      id="cowork-display-panel"
      ref={panelRef}
      className={`${isOpen ? 'flex' : 'hidden'} cowork-display-panel absolute inset-y-0 right-0 z-50 max-w-[calc(100%-2rem)] flex-col border-l border-border bg-surface shadow-xl`}
      style={
        isWorkspaceFullscreen
          ? { width: '100%', maxWidth: 'none', position: 'absolute', inset: 0, zIndex: 50 }
          : { width }
      }
      aria-label={i18nService.t('coworkCanvasTitle')}
      aria-hidden={!isOpen}
      data-workspace-fullscreen={isWorkspaceFullscreen}
    >
      <div
        className={`${isWorkspaceFullscreen ? '!hidden' : ''} cowork-display-panel-resizer absolute inset-y-0 left-0 z-[90] hidden w-5 -translate-x-1/2 touch-none cursor-col-resize`}
        onPointerDown={beginResize}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setWidth(current => clampWidth(current + (event.key === 'ArrowLeft' ? 24 : -24)));
        }}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={i18nService.t('resizePanels')}
        aria-valuemin={DISPLAY_PANEL_MIN_WIDTH}
        aria-valuemax={getDisplayPanelMaxWidth(panelRef.current)}
        aria-valuenow={Math.round(width)}
      />

      <div className="cowork-workspace-header relative z-20 flex shrink-0 items-stretch border-b border-border bg-surface px-2">
        <div className="flex h-full min-w-0 flex-1 items-stretch" data-testid="display-tab-cluster">
          <div
            className={`${tabs.length > 0 ? 'flex' : 'hidden'} h-full min-w-0 items-stretch overflow-x-auto overflow-y-hidden`}
            role={tabs.length > 0 ? 'tablist' : undefined}
            aria-label={tabs.length > 0 ? i18nService.t('coworkCanvasTitle') : undefined}
          >
            {tabs.map((tab, tabIndex) => {
              const isActive = tab.id === activeTabId;
              return (
                <React.Fragment key={tab.id}>
                  <div
                    className={`group flex h-full min-w-0 max-w-48 shrink-0 items-center rounded-t-lg border px-2 transition-colors ${
                      isActive
                        ? 'border-border border-b-surface bg-surface text-foreground'
                        : 'border-transparent text-secondary hover:bg-surface-raised hover:text-foreground'
                    }`}
                    onContextMenu={
                      tab.onContextMenu
                        ? event => {
                            event.preventDefault();
                            tab.onContextMenu?.({ x: event.clientX, y: event.clientY });
                          }
                        : undefined
                    }
                  >
                    <button
                      ref={element => {
                        if (element) tabButtonRefs.current.set(tab.id, element);
                        else tabButtonRefs.current.delete(tab.id);
                      }}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      tabIndex={isActive ? 0 : -1}
                      onClick={tab.onSelect}
                      onKeyDown={event => handleTabKeyDown(event, tabIndex)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-medium"
                      title={tab.label}
                    >
                      <span className="h-4 w-4 shrink-0" aria-hidden="true">
                        {tab.icon}
                      </span>
                      <span className="truncate">{tab.label}</span>
                    </button>
                    {tab.onClose && (
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation();
                          tab.onClose?.();
                        }}
                        className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-70 hover:bg-surface-raised hover:text-foreground group-hover:opacity-100"
                        aria-label={`${i18nService.t('close')}: ${tab.label}`}
                        title={i18nService.t('close')}
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {tabIndex < tabs.length - 1 && (
                    <span
                      data-testid="display-tab-divider"
                      className="h-4 w-px shrink-0 self-center bg-border/60"
                      aria-hidden="true"
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {tabs.length > 0 && actions && (
            <div className="flex h-full shrink-0 items-center">{actions}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsWorkspaceFullscreen(fullscreen => !fullscreen)}
          className="inline-flex h-7 w-8 shrink-0 self-center items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
          title={i18nService.t(
            isWorkspaceFullscreen
              ? 'coworkDisplayPanelExitFullscreen'
              : 'coworkDisplayPanelFullscreen',
          )}
          aria-label={i18nService.t(
            isWorkspaceFullscreen
              ? 'coworkDisplayPanelExitFullscreen'
              : 'coworkDisplayPanelFullscreen',
          )}
          aria-pressed={isWorkspaceFullscreen}
        >
          <WorkspaceFullscreenIcon className="h-4 w-4" expanded={isWorkspaceFullscreen} />
        </button>
        <button
          type="button"
          onClick={() => {
            setIsWorkspaceFullscreen(false);
            onClose();
          }}
          className="inline-flex h-7 w-8 shrink-0 self-center items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
          title={i18nService.t('coworkDisplayPanelClose')}
          aria-label={i18nService.t('coworkDisplayPanelClose')}
        >
          <RightSidebarIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {children}
        {tabs.length === 0 && emptyState && (
          <div className="absolute inset-0 z-10">{emptyState}</div>
        )}
      </div>
    </aside>
  );
};

export default CoworkDisplayPanel;
