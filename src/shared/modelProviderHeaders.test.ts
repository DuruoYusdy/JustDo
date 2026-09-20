import { describe, expect, test } from 'vitest';

import {
  mergeModelProviderHeaders,
  normalizeModelProviderHeaders,
  validateModelProviderHeaderName,
  validateModelProviderHeaderValue,
} from './modelProviderHeaders';

describe('model provider headers', () => {
  test('normalizes names and preserves values', () => {
    expect(normalizeModelProviderHeaders({ ' X-Tenant ': ' Bearer value ' })).toEqual({
      'X-Tenant': ' Bearer value ',
    });
  });

  test.each(['Host', 'content-length', 'Transfer-Encoding', '__proto__', 'constructor'])(
    'rejects forbidden transport header %s',
    name => {
      expect(validateModelProviderHeaderName(name)).toBe('forbidden-name');
    },
  );

  test('rejects duplicate names case-insensitively and newline values', () => {
    expect(() => normalizeModelProviderHeaders({ 'X-Test': 'one', 'x-test': 'two' })).toThrow(
      'duplicate-name',
    );
    expect(validateModelProviderHeaderValue('one\r\ntwo')).toBe('invalid-value');
    expect(validateModelProviderHeaderValue('   ')).toBe('invalid-value');
  });

  test('lets custom headers override generated headers explicitly', () => {
    expect(
      mergeModelProviderHeaders(
        { Authorization: 'Bearer generated', Accept: 'application/json' },
        { Authorization: 'Basic custom', 'X-Tenant': 'tenant-a' },
      ),
    ).toEqual({
      Authorization: 'Basic custom',
      Accept: 'application/json',
      'X-Tenant': 'tenant-a',
    });
  });

  test('overrides generated headers case-insensitively without duplicate names', () => {
    expect(
      mergeModelProviderHeaders(
        { Authorization: 'Bearer generated', 'Content-Type': 'application/json' },
        { authorization: 'Bearer custom', 'content-type': 'application/vnd.api+json' },
      ),
    ).toEqual({
      authorization: 'Bearer custom',
      'content-type': 'application/vnd.api+json',
    });
  });
});
