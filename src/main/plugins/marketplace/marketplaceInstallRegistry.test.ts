import { expect, test } from 'vitest';

import { PluginKind } from '../../../shared/plugins/marketplace';
import {
  type MarketplaceInstallRecordStore,
  MarketplaceInstallRegistry,
} from './marketplaceInstallRegistry';

const createRegistry = () => {
  const values = new Map<string, unknown>();
  const store: MarketplaceInstallRecordStore = {
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: <T>(key: string, value: T) => {
      values.set(key, value);
    },
  };
  return new MarketplaceInstallRegistry(() => store);
};

test('persists one marketplace identity per runtime plugin', () => {
  const registry = createRegistry();
  registry.upsert({
    sourceId: 'enterprise',
    kind: PluginKind.SKILL,
    marketplacePluginId: 'catalog-writer',
    runtimeId: 'writer',
    installedVersion: '1.0.0',
    installPath: 'C:\\skills\\writer',
  });

  expect(registry.list(PluginKind.SKILL)).toEqual([
    expect.objectContaining({ marketplacePluginId: 'catalog-writer', runtimeId: 'writer' }),
  ]);
});

test('only removes a layered skill identity when its install path matches', () => {
  const registry = createRegistry();
  registry.upsert({
    sourceId: 'enterprise',
    kind: PluginKind.SKILL,
    marketplacePluginId: 'catalog-writer',
    runtimeId: 'writer',
    installPath: 'C:\\managed\\skills\\writer',
  });

  registry.removeRuntime(PluginKind.SKILL, 'writer', 'C:\\project\\skills\\writer');
  expect(registry.list()).toHaveLength(1);

  registry.removeRuntime(PluginKind.SKILL, 'writer', 'c:\\managed\\skills\\writer');
  expect(registry.list()).toEqual([]);
});

test('ignores corrupt persisted records', () => {
  const values = new Map<string, unknown>([
    ['plugin_marketplace_installations_v1', [{ sourceId: 'enterprise', token: 'secret' }]],
  ]);
  const registry = new MarketplaceInstallRegistry(() => ({
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: <T>(key: string, value: T) => values.set(key, value),
  }));

  expect(registry.list()).toEqual([]);
});
