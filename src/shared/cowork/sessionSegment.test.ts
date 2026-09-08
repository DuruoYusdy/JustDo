import { describe, expect, test } from 'vitest';

import {
  buildCoworkExecutionSessionKey,
  buildCoworkSessionKey,
  isCoworkSessionKey,
  parseCoworkSessionKey,
} from './sessionSegment';

describe('cowork session keys', () => {
  test('keeps canonical and raw legacy keys readable', () => {
    expect(buildCoworkSessionKey('session-1')).toBe('agent:main:justdo:session-1');
    expect(parseCoworkSessionKey('agent:writer:justdo:session-1')).toEqual({
      agentId: 'writer',
      sessionId: 'session-1',
      executionId: null,
    });
    expect(parseCoworkSessionKey('justdo:session-1')).toEqual({
      agentId: null,
      sessionId: 'session-1',
      executionId: null,
    });
  });

  test('maps a distinct execution key back to its logical session', () => {
    const key = buildCoworkExecutionSessionKey('session-1', 'implementation-2', 'writer');

    expect(key).toBe('agent:writer:justdo:session-1:execution:implementation-2');
    expect(parseCoworkSessionKey(key)).toEqual({
      agentId: 'writer',
      sessionId: 'session-1',
      executionId: 'implementation-2',
    });
    expect(isCoworkSessionKey(key)).toBe(true);
  });

  test('rejects incomplete execution keys and unsafe builder parts', () => {
    expect(parseCoworkSessionKey('agent:main:justdo:session-1:execution:')).toBeNull();
    expect(() => buildCoworkExecutionSessionKey('session-1', 'bad:id')).toThrow('Execution ID');
    expect(isCoworkSessionKey('agent:main:main')).toBe(false);
  });
});
