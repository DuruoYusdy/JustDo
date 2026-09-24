import { parseSessionRetentionMs } from '../../shared/scheduledTask/retention';
import type { SchedulerSettings, SchedulerSettingsUpdate } from '../../shared/scheduledTask/types';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function readSchedulerSettings(config: unknown): SchedulerSettings {
  const cron = record(record(config).cron);
  return {
    enabled: cron.enabled !== false,
    skipMissedJobs: cron.skipMissedJobs === true,
    sessionRetention:
      cron.sessionRetention === false
        ? false
        : typeof cron.sessionRetention === 'string'
          ? cron.sessionRetention
          : '24h',
  };
}

export function buildSchedulerSettingsPatch(input: SchedulerSettingsUpdate): {
  cron: Partial<SchedulerSettings>;
} {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    typeof input.revision !== 'string' ||
    !input.revision.trim() ||
    !input.patch ||
    typeof input.patch !== 'object' ||
    Array.isArray(input.patch) ||
    Object.keys(input).some(key => !['revision', 'patch'].includes(key)) ||
    Object.keys(input.patch).some(
      key => !['enabled', 'skipMissedJobs', 'sessionRetention'].includes(key),
    )
  ) {
    throw new Error('Invalid scheduler settings');
  }
  const cron: Partial<SchedulerSettings> = {};
  for (const key of ['enabled', 'skipMissedJobs'] as const) {
    if (key in input.patch) {
      if (typeof input.patch[key] !== 'boolean') throw new Error('Invalid scheduler switch');
      cron[key] = input.patch[key];
    }
  }
  if ('sessionRetention' in input.patch) {
    const value = input.patch.sessionRetention;
    if (
      value !== false &&
      (typeof value !== 'string' || value.length > 128 || parseSessionRetentionMs(value) === null)
    ) {
      throw new Error('Invalid scheduler session retention');
    }
    cron.sessionRetention =
      value === false || parseSessionRetentionMs(value) === 0 ? false : value.trim();
  }
  return { cron };
}
