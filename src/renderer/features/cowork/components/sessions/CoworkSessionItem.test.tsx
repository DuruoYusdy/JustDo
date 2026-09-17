// @vitest-environment jsdom

import { DndContext } from '@dnd-kit/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import CoworkSessionItem from './CoworkSessionItem';

const renderSessionItem = (options?: { isRuntimeRunning?: boolean }) => {
  const onExport = vi.fn();
  const onCopy = vi.fn();
  render(
    <DndContext>
      <CoworkSessionItem
        session={{
          id: 'session-1',
          title: 'Planning',
          status: 'idle',
          pinned: false,
          createdAt: 1,
          updatedAt: 2,
        }}
        hasUnread={false}
        isActive
        isRuntimeRunning={options?.isRuntimeRunning}
        isBatchMode={false}
        isSelected={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onExport={onExport}
        onCopy={onCopy}
        onTogglePinned={vi.fn()}
        onToggleSelection={vi.fn()}
        onEnterBatchMode={vi.fn()}
      />
    </DndContext>,
  );
  fireEvent.contextMenu(screen.getByText('Planning'));
  return { onExport, onCopy };
};

afterEach(cleanup);

describe('CoworkSessionItem context menu session actions', () => {
  it('offers export and copy for the selected session', () => {
    i18nService.setLanguage('en', { persist: false });
    const { onExport, onCopy } = renderSessionItem();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Export session' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByText('Planning'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy current session' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('disables export and copy while the session runtime is active', () => {
    i18nService.setLanguage('en', { persist: false });
    renderSessionItem({ isRuntimeRunning: true });

    const exportItem = screen.getByRole('menuitem', { name: 'Export session' });
    const copyItem = screen.getByRole('menuitem', { name: 'Copy current session' });
    expect(exportItem.hasAttribute('disabled')).toBe(true);
    expect(exportItem.getAttribute('title')).toBe(
      'Wait for the current response to finish before exporting',
    );
    expect(copyItem.hasAttribute('disabled')).toBe(true);
    expect(copyItem.getAttribute('title')).toBe(
      'Wait for the current response to finish before copying',
    );
  });

  it('opens the context menu from the keyboard and supports arrow navigation', async () => {
    i18nService.setLanguage('en', { persist: false });
    renderSessionItem();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    const sessionItem = screen.getByRole('button', { name: 'Planning' });
    sessionItem.focus();
    fireEvent.keyDown(sessionItem, { key: 'F10', shiftKey: true });

    const menuItems = screen.getAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(menuItems[0]));
    fireEvent.keyDown(menuItems[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(menuItems[1]);
  });
});
