import { expect, test } from 'vitest';

import { buildSchedulerSettingsPatch, readSchedulerSettings } from './schedulerSettings';

test('reads native defaults and preserves an explicit disabled cleanup setting', () => {
  expect(readSchedulerSettings({})).toEqual({
    enabled: true,
    skipMissedJobs: false,
    sessionRetention: '24h',
  });
  expect(
    readSchedulerSettings({
      cron: { enabled: false, skipMissedJobs: true, sessionRetention: false },
    }),
  ).toEqual({ enabled: false, skipMissedJobs: true, sessionRetention: false });
});

test('patches only requested scheduler fields without replacing unrelated native configuration', () => {
  expect(
    buildSchedulerSettingsPatch({ revision: 'v1', patch: { sessionRetention: '1h30m' } }),
  ).toEqual({ cron: { sessionRetention: '1h30m' } });
  expect(
    buildSchedulerSettingsPatch({ revision: 'v1', patch: { sessionRetention: '0h' } }),
  ).toEqual({ cron: { sessionRetention: false } });
  expect(
    buildSchedulerSettingsPatch({ revision: 'v1', patch: { sessionRetention: false } }),
  ).toEqual({ cron: { sessionRetention: false } });
});

test.each([
  { revision: '', patch: { enabled: false } },
  { revision: 'v', patch: { sessionRetention: 'forever' } },
  { revision: 'v', patch: { sessionRetention: '-7d' } },
  { revision: 'v', patch: { sessionRetention: true } },
  { revision: 'v', patch: { sessionRetention: '9007199254740992d' } },
  { revision: 'v', patch: { enabled: 'false' } },
  { revision: 'v', patch: { webhookToken: 'unsupported' } },
])('rejects malformed settings at the main-process boundary: %j', input => {
  expect(() => buildSchedulerSettingsPatch(input as never)).toThrow();
});
