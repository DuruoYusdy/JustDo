import { describe, expect, it, vi } from 'vitest';

import type { MulticaIntegrationStatus } from '../../../shared/multica';
import type { SqliteStore } from '../../data/sqliteStore';
import { MulticaIntegrationService } from './multicaIntegrationService';

describe('MulticaIntegrationService', () => {
  it('persists the disabled state even when launcher cleanup fails', async () => {
    let state = {
      enabled: true,
      launcherPath: 'owned-launcher',
      command: 'owned-launcher',
    };
    const store = {
      get: vi.fn(() => state),
      set: vi.fn((_key: string, next: typeof state) => {
        state = next;
      }),
    } as unknown as SqliteStore;
    const service = new MulticaIntegrationService({
      getStore: () => store,
      getBridgeState: () => ({ running: true, activeTaskCount: 0 }),
      ensureBridgeRunning: vi.fn().mockResolvedValue(undefined),
      getOpenClawVersion: () => 'v2026.9.2',
      getLauncherTarget: () => ({ path: 'unused', args: [] }),
      removeLauncher: () => {
        throw new Error('locked');
      },
    });
    vi.spyOn(service, 'getStatus').mockResolvedValue({
      enabled: false,
    } as MulticaIntegrationStatus);

    const result = await service.disable();

    expect(result.success).toBe(true);
    expect(state.enabled).toBe(false);
    expect(store.set).toHaveBeenCalledWith(
      'multica_integration_v2',
      expect.objectContaining({ enabled: false }),
    );
  });

  it('does not enable the integration when the local bridge cannot start', async () => {
    let state = { enabled: false, launcherPath: '', command: '' };
    const store = {
      get: vi.fn(() => state),
      set: vi.fn((_key: string, next: typeof state) => {
        state = next;
      }),
    } as unknown as SqliteStore;
    const service = new MulticaIntegrationService({
      getStore: () => store,
      getBridgeState: () => ({ running: false, activeTaskCount: 0 }),
      ensureBridgeRunning: vi.fn().mockRejectedValue(new Error('listen failed')),
      getOpenClawVersion: () => 'v2026.9.2',
      getLauncherTarget: () => ({ path: 'unused', args: [] }),
    });
    vi.spyOn(service, 'getStatus').mockResolvedValue({
      enabled: false,
    } as MulticaIntegrationStatus);

    const result = await service.enable();

    expect(result.success).toBe(false);
    expect(state.enabled).toBe(false);
    expect(store.set).not.toHaveBeenCalled();
  });
});
