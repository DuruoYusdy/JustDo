// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { CronView } from './CronView';

const state = {
  scheduledTask: { tasks: [], loading: false, error: null, unreadResultCount: 0, runs: {} },
  agent: { agents: [] },
};
vi.mock('react-redux', () => ({
  useSelector: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock('@/services/i18n', () => ({
  i18nService: { t: (key: string) => key, getLanguage: () => 'en' },
}));
vi.mock('@/app/shell/window/WindowTitleBar', () => ({ default: () => null }));
vi.mock('@/features/scheduled-tasks/scheduledTaskService', () => ({
  scheduledTaskService: { loadTasks: vi.fn(), listChannels: vi.fn().mockResolvedValue([]) },
}));
vi.mock('./memoryDreamingControl', () => ({
  useMemoryDreamingControl: () => ({ settings: null }),
  withMemoryDreamingCard: (tasks: unknown[]) => tasks,
}));
vi.mock('./skillReviewCard', () => ({
  SKILL_REVIEW_CARD_ID: 'skill-review',
  withSkillReviewCard: (tasks: unknown[]) => tasks,
}));
vi.mock('./SchedulerSettingsDialog', () => ({
  default: ({
    onSaved,
    onClose,
  }: {
    onSaved: (settings: { enabled: boolean }) => void;
    onClose: () => void;
  }) => (
    <button
      onClick={() => {
        onSaved({ enabled: false });
        onClose();
      }}
    >
      save-paused
    </button>
  ),
}));
afterEach(cleanup);

test('a delayed initial settings read does not overwrite the saved scheduling state', async () => {
  let resolveInitial!: (value: unknown) => void;
  const getSchedulerSettings = vi.fn(
    () =>
      new Promise(resolve => {
        resolveInitial = resolve;
      }),
  );
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { platform: 'win32', scheduledTasks: { getSchedulerSettings } },
  });
  render(<CronView />);
  fireEvent.click(screen.getByRole('button', { name: 'schedulerSettingsTitle' }));
  fireEvent.click(screen.getByRole('button', { name: 'save-paused' }));
  expect(screen.getByText('schedulerSettingsPaused')).toBeTruthy();
  await act(async () => {
    resolveInitial({ success: true, snapshot: { settings: { enabled: true } } });
  });
  expect(screen.getByText('schedulerSettingsPaused')).toBeTruthy();
});
