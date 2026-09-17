import { describe, expect, test } from 'vitest';

import { buildCoworkSessionKey, isCoworkSessionKey, parseCoworkSessionKey } from './sessionKey';

describe('cowork session keys', () => {
  test('builds and parses canonical session keys', () => {
    expect(buildCoworkSessionKey('session-1')).toBe('agent:main:justdo:session-1');
    expect(parseCoworkSessionKey('agent:writer:justdo:session-1')).toEqual({
      agentId: 'writer',
      sessionId: 'session-1',
    });
  });

  test('keeps raw local keys readable and rejects execution suffixes', () => {
    expect(parseCoworkSessionKey('justdo:session-1')).toEqual({
      agentId: null,
      sessionId: 'session-1',
    });
    expect(parseCoworkSessionKey('agent:main:justdo:session-1:execution:plan-1')).toBeNull();
    expect(isCoworkSessionKey('agent:main:main')).toBe(false);
  });
});
