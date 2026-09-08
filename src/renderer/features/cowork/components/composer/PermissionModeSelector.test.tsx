// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import PermissionModeSelector from './PermissionModeSelector';

const mocks = vi.hoisted(() => ({
  state: {
    cowork: {
      config: { permissionMode: 'ask' },
      currentSession: null as { id: string; permissionMode: 'ask' | 'auto' | 'full' } | null,
      newSessionPlanMode: false,
      planModeBySession: {} as Record<string, boolean>,
    },
  },
  setPlanMode: vi.fn(),
  updatePermissionMode: vi.fn(),
}));

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

vi.mock('@/features/cowork/coworkService', () => ({
  coworkService: {
    setPlanMode: mocks.setPlanMode,
    updatePermissionMode: mocks.updatePermissionMode,
  },
}));

vi.mock('@/services/i18n', () => ({
  i18nService: { t: (key: string) => key },
}));

const openSelector = () =>
  fireEvent.click(screen.getByRole('button', { name: 'permissionModeTitle' }));

describe('PermissionModeSelector Plan mode', () => {
  beforeEach(() => {
    mocks.state.cowork.config.permissionMode = 'ask';
    mocks.state.cowork.currentSession = null;
    mocks.state.cowork.newSessionPlanMode = false;
    mocks.state.cowork.planModeBySession = {};
    mocks.setPlanMode.mockReset().mockResolvedValue(true);
    mocks.updatePermissionMode.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(cleanup);

  test('offers Plan as the third permission-menu entry and enables it locally', async () => {
    render(<PermissionModeSelector />);
    openSelector();

    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'permissionModeAskpermissionModeAskDescription',
      'permissionModeAutopermissionModeAutoDescription',
      'planModeTitleplanModeDescription',
      'permissionModeFullpermissionModeFullDescription',
    ]);
    fireEvent.click(screen.getByText('planModeTitle').closest('button')!);

    await waitFor(() => expect(mocks.setPlanMode).toHaveBeenCalledWith(undefined, true));
    expect(mocks.updatePermissionMode).not.toHaveBeenCalled();
  });

  test('selecting a permission exits an active session Plan mode without passing Plan to permission IPC', async () => {
    mocks.state.cowork.currentSession = { id: 'session-1', permissionMode: 'ask' };
    mocks.state.cowork.planModeBySession = { 'session-1': true };
    render(<PermissionModeSelector />);
    openSelector();

    fireEvent.click(screen.getByText('permissionModeAuto').closest('button')!);

    await waitFor(() => expect(mocks.setPlanMode).toHaveBeenCalledWith('session-1', false));
    expect(mocks.updatePermissionMode).toHaveBeenCalledWith('auto');
    expect(mocks.updatePermissionMode).not.toHaveBeenCalledWith('plan');
  });

  test('does not change the underlying permission when exiting Plan mode fails', async () => {
    mocks.state.cowork.currentSession = { id: 'session-1', permissionMode: 'ask' };
    mocks.state.cowork.planModeBySession = { 'session-1': true };
    mocks.setPlanMode.mockResolvedValue(false);
    render(<PermissionModeSelector />);
    openSelector();

    fireEvent.click(screen.getByText('permissionModeAuto').closest('button')!);

    await waitFor(() => expect(mocks.setPlanMode).toHaveBeenCalledWith('session-1', false));
    expect(mocks.updatePermissionMode).not.toHaveBeenCalled();
  });

  test('restores Plan mode when the requested permission fails to save', async () => {
    mocks.state.cowork.currentSession = { id: 'session-1', permissionMode: 'ask' };
    mocks.state.cowork.planModeBySession = { 'session-1': true };
    mocks.updatePermissionMode.mockResolvedValue({ success: false, error: 'save failed' });
    render(<PermissionModeSelector />);
    openSelector();

    fireEvent.click(screen.getByText('permissionModeAuto').closest('button')!);

    await waitFor(() => expect(mocks.setPlanMode).toHaveBeenCalledTimes(2));
    expect(mocks.setPlanMode.mock.calls).toEqual([
      ['session-1', false],
      ['session-1', true],
    ]);
    expect(mocks.updatePermissionMode).toHaveBeenCalledWith('auto');
  });

  test('switches away from Plan mode without stopping an active run', async () => {
    mocks.state.cowork.currentSession = { id: 'session-1', permissionMode: 'ask' };
    mocks.state.cowork.planModeBySession = { 'session-1': true };
    render(<PermissionModeSelector runActive />);

    openSelector();
    fireEvent.click(screen.getByText('permissionModeAuto').closest('button')!);

    await waitFor(() => expect(mocks.updatePermissionMode).toHaveBeenCalledWith('auto'));
    expect(mocks.setPlanMode).toHaveBeenCalledWith('session-1', false);
  });
});
