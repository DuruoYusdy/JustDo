// @vitest-environment jsdom
import type { ScheduledTask } from '@shared/scheduledTask/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { i18nService } from '@/services/i18n';

import { CreateEditDialog } from './CronView';

vi.mock('@/features/scheduled-tasks/scheduledTaskService', () => ({
  scheduledTaskService: { listChannels: vi.fn().mockResolvedValue([]) },
}));
afterEach(cleanup);

const job = {
  id: 'task',
  name: 'Report',
  description: '',
  enabled: true,
  schedule: { kind: 'every', everyMs: 60000 },
  sessionTarget: 'isolated',
  wakeMode: 'now',
  payload: { kind: 'agentTurn', message: 'Report updates', toolsAllow: ['*'] },
  delivery: { mode: 'none' },
  state: {},
} as ScheduledTask;

function permissionSelect() {
  return screen.getByLabelText(i18nService.t('cronDialogPermissionTitle')) as HTMLSelectElement;
}

describe('scheduled task permission form', () => {
  test('system events show inherited permissions and save without a permission preset', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateEditDialog
        open
        job={{ ...job, sessionTarget: 'main', payload: { kind: 'systemEvent', text: 'Wake up' } }}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    expect(document.querySelector('#scheduled-task-permission')).toBeNull();
    expect(screen.getByText(i18nService.t('cronDialogPermissionInheritedHint'))).toBeTruthy();
    fireEvent.click(screen.getByText(i18nService.t('cronDialogSaveChanges')));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('permissionMode');
  });

  test('saves an explicit mode change and resets permissions each time the dialog opens', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const props = { onSave, onClose: () => {} };
    const { rerender } = render(<CreateEditDialog {...props} open job={job} />);
    expect(permissionSelect().value).toBe('full');
    fireEvent.change(permissionSelect(), { target: { value: 'read-only' } });
    fireEvent.click(screen.getByText(i18nService.t('cronDialogSaveChanges')));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].permissionMode).toBe('read-only');

    rerender(<CreateEditDialog {...props} open={false} />);
    rerender(<CreateEditDialog {...props} open job={job} />);
    expect(permissionSelect().value).toBe('full');
    rerender(<CreateEditDialog {...props} open={false} />);
    rerender(<CreateEditDialog {...props} open />);
    expect(permissionSelect().value).toBe('read-only');
  });
});
