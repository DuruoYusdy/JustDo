import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { i18nService } from '@/services/i18n';

const getSystemTerminalLabel = (): string => {
  if (window.electron.platform === 'win32') {
    return i18nService.t('coworkOpenWindowsSystemTerminal');
  }
  if (window.electron.platform === 'darwin') {
    return i18nService.t('coworkOpenMacSystemTerminal');
  }
  return i18nService.t('coworkOpenSystemTerminal');
};

interface TerminalTabContextMenuProps {
  onDismiss: () => void;
  onOpenSystemTerminal: () => void;
  x: number;
  y: number;
}

const TerminalTabContextMenu = ({
  onDismiss,
  onOpenSystemTerminal,
  x,
  y,
}: TerminalTabContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const left = Math.max(8, Math.min(x, window.innerWidth - 264));
  const top = Math.max(8, Math.min(y, window.innerHeight - 64));

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => trigger?.focus();
  }, []);

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[109] cursor-default"
        aria-label={i18nService.t('coworkTerminalTabMenuDismiss')}
        onClick={onDismiss}
        onContextMenu={event => {
          event.preventDefault();
          onDismiss();
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label={i18nService.t('coworkTerminalTabMenu')}
        className="fixed z-[110] w-64 rounded-lg border border-border bg-background p-1.5 text-sm text-foreground shadow-2xl"
        style={{ left, top }}
        onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onDismiss();
        }}
      >
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-surface-raised"
          onClick={onOpenSystemTerminal}
        >
          <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0" />
          <span>{getSystemTerminalLabel()}</span>
        </button>
      </div>
    </>,
    document.body,
  );
};

export default TerminalTabContextMenu;
