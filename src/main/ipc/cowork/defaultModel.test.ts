import { beforeEach, describe, expect, test, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { registerDefaultModelHandlers } from './defaultModel';

describe('default model IPC', () => {
  const updateAgent = vi.fn();
  const syncOpenClawConfig = vi.fn();
  let appConfig: Record<string, unknown>;

  beforeEach(() => {
    handlers.clear();
    updateAgent.mockReset();
    syncOpenClawConfig.mockReset();
    syncOpenClawConfig.mockResolvedValue({ success: true });
    appConfig = {};

    registerDefaultModelHandlers({
      getStore: () =>
        ({
          get: () => appConfig,
          set: (_key: string, value: Record<string, unknown>) => {
            appConfig = value;
          },
        }) as never,
      getCoworkStore: () =>
        ({
          getAgent: () => ({ id: 'main', model: 'custom_0/old-model' }),
          updateAgent,
        }) as never,
      syncOpenClawConfig,
    });
  });

  test('persists main selection in app config and clears its legacy profile override', async () => {
    const result = await handlers.get('config:setDefaultModel')?.(
      {},
      {
        modelId: 'custom-model',
        providerKey: 'custom_0',
        modelRef: 'acme/custom-model',
        agentId: 'main',
      },
    );

    expect(result).toEqual({ success: true });
    expect(updateAgent).toHaveBeenCalledWith('main', { model: '' });
    expect(appConfig).toMatchObject({
      model: {
        defaultModel: 'custom-model',
        defaultModelProvider: 'custom_0',
      },
    });
  });

  test('restores app selection and legacy metadata if Gateway rejects the change', async () => {
    appConfig = {
      model: { defaultModel: 'old-model', defaultModelProvider: 'custom_0' },
      theme: 'dark',
    };
    syncOpenClawConfig.mockResolvedValueOnce({ success: false, error: 'sync rejected' });
    const result = await handlers.get('config:setDefaultModel')?.(
      {},
      { modelId: 'new-model', providerKey: 'openai', agentId: 'main' },
    );
    expect(result).toEqual({ success: false, error: 'sync rejected' });
    expect(appConfig).toEqual({
      model: { defaultModel: 'old-model', defaultModelProvider: 'custom_0' },
      theme: 'dark',
    });
    expect(updateAgent).toHaveBeenNthCalledWith(1, 'main', { model: '' });
    expect(updateAgent).toHaveBeenNthCalledWith(2, 'main', { model: 'custom_0/old-model' });
    expect(syncOpenClawConfig).toHaveBeenLastCalledWith({
      reason: 'default-model-change-rollback',
    });
  });

  test('clears main profile overrides for callers without a canonical reference', async () => {
    await handlers.get('config:setDefaultModel')?.(
      {},
      {
        modelId: 'custom-model',
        providerKey: 'custom_0',
        agentId: 'main',
      },
    );

    expect(updateAgent).toHaveBeenCalledWith('main', { model: '' });
  });
});

test('changing a specialist model does not replace the application default', async () => {
  const set = vi.fn();
  const updateAgent = vi.fn();
  registerDefaultModelHandlers({
    getStore: () => ({ get: () => ({ model: { defaultModel: 'original' } }), set }) as never,
    getCoworkStore: () => ({ getAgent: () => ({ id: 'review', model: '' }), updateAgent }) as never,
    syncOpenClawConfig: async () => ({ success: true }),
  });
  await handlers.get('config:setDefaultModel')?.(
    {},
    { agentId: 'review', providerKey: 'openai', modelId: 'review-model' },
  );
  expect(set).not.toHaveBeenCalled();
  expect(updateAgent).toHaveBeenCalledWith('review', { model: 'openai/review-model' });
});
