import path from 'path';

import type { MarketplacePluginKind } from '../../../shared/plugins/marketplace';
import { MarketplacePluginKind as MarketplaceKinds } from '../../../shared/plugins/marketplace';

const STORE_KEY = 'plugin_marketplace_installations_v1';
const kinds = new Set<string>(Object.values(MarketplaceKinds));

export interface MarketplaceInstallRecord {
  sourceId: string;
  kind: MarketplacePluginKind;
  marketplacePluginId: string;
  runtimeId: string;
  installedVersion?: string;
  installPath?: string;
}

export interface MarketplaceInstallRecordStore {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
}

const validText = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && Boolean(value.trim()) && value.length <= maxLength;

const normalizeRecord = (value: unknown): MarketplaceInstallRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<MarketplaceInstallRecord>;
  if (
    !validText(record.sourceId, 256) ||
    !validText(record.kind, 32) ||
    !kinds.has(record.kind) ||
    !validText(record.marketplacePluginId, 256) ||
    !validText(record.runtimeId, 256) ||
    (record.installedVersion !== undefined &&
      (typeof record.installedVersion !== 'string' || record.installedVersion.length > 128)) ||
    (record.installPath !== undefined &&
      (typeof record.installPath !== 'string' || record.installPath.length > 4_096))
  ) {
    return null;
  }
  return {
    sourceId: record.sourceId.trim(),
    kind: record.kind as MarketplacePluginKind,
    marketplacePluginId: record.marketplacePluginId.trim(),
    runtimeId: record.runtimeId.trim(),
    installedVersion: record.installedVersion?.trim() || undefined,
    installPath: record.installPath?.trim() || undefined,
  };
};

const samePath = (left: string, right: string): boolean =>
  path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

/** Persists marketplace identity only; runtime inventories remain installation authority. */
export class MarketplaceInstallRegistry {
  constructor(private readonly getStore: () => MarketplaceInstallRecordStore) {}

  list(kind?: MarketplacePluginKind): MarketplaceInstallRecord[] {
    const stored = this.getStore().get<unknown>(STORE_KEY);
    if (!Array.isArray(stored)) return [];
    return stored
      .map(normalizeRecord)
      .filter((record): record is MarketplaceInstallRecord => Boolean(record))
      .filter(record => !kind || record.kind === kind);
  }

  upsert(record: MarketplaceInstallRecord): void {
    const normalized = normalizeRecord(record);
    if (!normalized) throw new Error('Invalid marketplace installation record');
    const records = this.list().filter(
      current =>
        current.kind !== normalized.kind ||
        (current.runtimeId.toLowerCase() !== normalized.runtimeId.toLowerCase() &&
          (current.sourceId !== normalized.sourceId ||
            current.marketplacePluginId.toLowerCase() !==
              normalized.marketplacePluginId.toLowerCase())),
    );
    records.push(normalized);
    this.getStore().set(STORE_KEY, records);
  }

  removeRuntime(kind: MarketplacePluginKind, runtimeId: string, installPath?: string): void {
    const normalizedId = runtimeId.trim().toLowerCase();
    if (!normalizedId) return;
    const records = this.list();
    const next = records.filter(record => {
      if (record.kind !== kind || record.runtimeId.toLowerCase() !== normalizedId) return true;
      if (!installPath) return false;
      return !record.installPath || !samePath(record.installPath, installPath);
    });
    if (next.length !== records.length) this.getStore().set(STORE_KEY, next);
  }
}
