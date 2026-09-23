import { describe, expect, test } from 'vitest';

import {
  applyScheduledTaskPermission,
  getScheduledTaskPermission,
  SCHEDULED_TASK_READ_ONLY_TOOLS,
  ScheduledTaskPermission,
} from './permissions';

describe('scheduled task permission presets', () => {
  test('read-only replaces broader tools with a bounded retrieval allowlist', () => {
    const payload = applyScheduledTaskPermission(
      { kind: 'agentTurn', message: 'Report', toolsAllow: ['*'], timeoutSeconds: 30 },
      ScheduledTaskPermission.ReadOnly,
    );
    expect(payload.toolsAllow).toEqual(SCHEDULED_TASK_READ_ONLY_TOOLS);
    expect(payload.toolsAllow).not.toContain('exec');
    expect(payload.toolsAllow).not.toContain('sessions_spawn');
    expect(getScheduledTaskPermission(payload)).toBe(ScheduledTaskPermission.ReadOnly);
    expect(payload).toMatchObject({ message: 'Report', timeoutSeconds: 30 });
  });

  test('recognizes legacy and custom restrictions without widening them', () => {
    expect(getScheduledTaskPermission({})).toBe(ScheduledTaskPermission.Full);
    const payload = { kind: 'agentTurn' as const, message: 'Report', toolsAllow: [] };
    expect(getScheduledTaskPermission(payload)).toBe(ScheduledTaskPermission.Custom);
    expect(applyScheduledTaskPermission(payload, ScheduledTaskPermission.Custom)).toBe(payload);
  });

  test('rejects presets for system events whose main-session execution ignores task allowlists', () => {
    for (const mode of Object.values(ScheduledTaskPermission)) {
      expect(() =>
        applyScheduledTaskPermission({ kind: 'systemEvent', text: 'Wake up' }, mode),
      ).toThrow('Permission presets require an agent-turn task payload');
    }
  });

  test('requires an explicit valid mode to allow unrestricted tools', () => {
    const payload = { kind: 'agentTurn' as const, message: 'Report' };
    expect(applyScheduledTaskPermission(payload, ScheduledTaskPermission.Full).toolsAllow).toEqual([
      '*',
    ]);
    expect(() =>
      applyScheduledTaskPermission(payload, 'invalid' as ScheduledTaskPermission),
    ).toThrow();
  });
});
