import { describe, expect, test } from 'vitest';

import {
  browserAgentPanelOperationKey,
  isAgentBrowserSessionAvailable,
  promotePendingBrowserPanelItems,
  takeAvailableBrowserAgentPanelStates,
} from './browserPanelRetention';

describe('browser panel session retention', () => {
  test('moves and bounds pending tabs across consecutive session promotions', () => {
    const pending = new Map<string, string[]>([
      ['__home__', ['home-1', 'home-2']],
      ['temp-1', ['temp-existing']],
    ]);

    promotePendingBrowserPanelItems(pending, '__home__', 'temp-1', 3);
    promotePendingBrowserPanelItems(pending, 'temp-1', 'session-1', 3);

    expect(pending.has('__home__')).toBe(false);
    expect(pending.has('temp-1')).toBe(false);
    expect(pending.get('session-1')).toEqual(['temp-existing', 'home-1', 'home-2']);
  });

  test('accepts only canonical sessions that still exist', () => {
    const sessions = ['session-1', 'session-2'];

    expect(isAgentBrowserSessionAvailable(sessions, 'session-1')).toBe(true);
    expect(isAgentBrowserSessionAvailable(sessions, 'deleted-session')).toBe(false);
    expect(isAgentBrowserSessionAvailable(['temp-1'], 'temp-1')).toBe(false);
    expect(isAgentBrowserSessionAvailable(sessions, '__home__')).toBe(false);
  });

  test('replays a panel lock that arrives before its canonical session is registered', () => {
    const event = {
      sessionId: 'session-new',
      targetId: '__browser-agent-panel__',
      profile: 'embedded',
      operationId: 'operation-1',
      busy: true,
    };
    const operationKey = browserAgentPanelOperationKey(event);
    expect(operationKey).not.toBeNull();
    const pending = new Map([
      [operationKey!, { event, timeoutId: 42 }],
    ]);

    expect(takeAvailableBrowserAgentPanelStates(pending, [])).toEqual([]);
    expect(pending.size).toBe(1);
    expect(takeAvailableBrowserAgentPanelStates(pending, ['session-new'])).toEqual([
      { event, timeoutId: 42 },
    ]);
    expect(pending.size).toBe(0);
  });
});
