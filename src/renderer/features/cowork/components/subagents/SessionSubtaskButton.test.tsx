// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import SessionSubtaskButton from './SessionSubtaskButton';

afterEach(cleanup);

describe('assistant session subtasks', () => {
  it('loads only the selected parent session and opens the existing detail with that parent', async () => {
    const task = {
      id: 'child',
      sessionKey: 'agent:review:subagent:child',
      label: 'Review child',
      status: 'done',
    };
    const getSubTaskStatus = vi.fn(async () => ({ success: true, subagents: [task] }));
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        cowork: { getSubTaskStatus, onSubtasksChanged: vi.fn(() => vi.fn()) },
      },
    });
    const open = vi.fn();
    render(
      <SessionSubtaskButton
        sessionId="review-task-session"
        parentRunning={false}
        onOpenSubtask={open}
      />,
    );
    const button = await screen.findByRole('button', { name: i18nService.t('subtaskShow') });
    expect(button.textContent).toBe('1');
    expect(getSubTaskStatus).toHaveBeenCalledWith('review-task-session');
    fireEvent.click(button);
    const panel = await screen.findByRole('complementary', { name: i18nService.t('subtasks') });
    expect(panel.id).toBe(button.getAttribute('aria-controls'));
    expect(panel.id).not.toBe('cowork-subtask-list');
    fireEvent.click(await screen.findByRole('button', { name: 'Review child' }));
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'child' }),
      'review-task-session',
    );
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('hides empty parents and ignores a previous assistant response after switching', async () => {
    let resolvePrevious!: (value: unknown) => void;
    const getSubTaskStatus = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolvePrevious = resolve;
          }),
      )
      .mockResolvedValue({ success: true, subagents: [] });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        cowork: { getSubTaskStatus, onSubtasksChanged: vi.fn(() => vi.fn()) },
      },
    });
    const open = vi.fn();
    const { rerender } = render(
      <SessionSubtaskButton
        key="first"
        sessionId="first"
        parentRunning={false}
        onOpenSubtask={open}
      />,
    );
    rerender(
      <SessionSubtaskButton
        key="second"
        sessionId="second"
        parentRunning={false}
        onOpenSubtask={open}
      />,
    );
    await waitFor(() => expect(getSubTaskStatus).toHaveBeenCalledWith('second'));
    await act(async () =>
      resolvePrevious({
        success: true,
        subagents: [{ id: 'old', label: 'Old task', status: 'running' }],
      }),
    );
    expect(screen.queryByRole('button', { name: i18nService.t('subtaskShow') })).toBeNull();
  });
});
