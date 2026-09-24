// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import SchedulerSettingsDialog from './SchedulerSettingsDialog';

vi.mock('@/services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
afterEach(cleanup);

const snapshot = {
  settings: { enabled: true, skipMissedJobs: false, sessionRetention: '7d' },
  revision: 'viewed-revision',
};
function setup(result = { success: true }) {
  const getSchedulerSettings = vi.fn().mockResolvedValue({ success: true, snapshot });
  const updateSchedulerSettings = vi.fn().mockResolvedValue(result);
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { scheduledTasks: { getSchedulerSettings, updateSchedulerSettings } },
  });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(createElement(SchedulerSettingsDialog, { onClose, onSaved }));
  return { getSchedulerSettings, updateSchedulerSettings, onClose, onSaved };
}

test('loads native settings and saves only changed retention with the displayed revision', async () => {
  const { updateSchedulerSettings, onSaved } = setup();
  const select = await screen.findByLabelText('schedulerSettingsRetention');
  expect((select as HTMLSelectElement).value).toBe('7d');
  expect((screen.getByRole('button', { name: 'save' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(select, { target: { value: 'forever' } });
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await waitFor(() =>
    expect(updateSchedulerSettings).toHaveBeenCalledWith({
      revision: 'viewed-revision',
      patch: { sessionRetention: false },
    }),
  );
  expect(onSaved).toHaveBeenCalledWith({ ...snapshot.settings, sessionRetention: false });
});

test('validates a custom duration and maps catch-up to the native skip flag', async () => {
  const { updateSchedulerSettings } = setup();
  fireEvent.change(await screen.findByLabelText('schedulerSettingsRetention'), {
    target: { value: 'custom' },
  });
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: '-2d' } });
  expect((screen.getByRole('button', { name: 'save' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: '1h30m' } });
  fireEvent.click(screen.getByRole('switch', { name: 'schedulerSettingsCatchUp' }));
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await waitFor(() =>
    expect(updateSchedulerSettings).toHaveBeenCalledWith({
      revision: 'viewed-revision',
      patch: { skipMissedJobs: true, sessionRetention: '1h30m' },
    }),
  );
});

test('keeps the dialog open when saving fails and supports reloading a fresh revision', async () => {
  const { onClose, onSaved, getSchedulerSettings } = setup({ success: false });
  await screen.findByLabelText('schedulerSettingsRetention');
  fireEvent.click(screen.getByRole('switch', { name: 'schedulerSettingsEnabled' }));
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await screen.findByText('schedulerSettingsSaveFailed');
  expect(onClose).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'schedulerSettingsReload' }));
  await waitFor(() => expect(getSchedulerSettings).toHaveBeenCalledTimes(2));
});

test('cancel discards changes without writing configuration', async () => {
  const { updateSchedulerSettings, onClose } = setup();
  fireEvent.change(await screen.findByLabelText('schedulerSettingsRetention'), {
    target: { value: '30d' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(updateSchedulerSettings).not.toHaveBeenCalled();
});
