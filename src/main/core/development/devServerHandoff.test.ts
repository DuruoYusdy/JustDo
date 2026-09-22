import { describe, expect, test } from 'vitest';

import { DEV_SERVER_URL_SWITCH } from '../appConstants';
import { getDevServerUrlFromCommandLine } from './devServerHandoff';

describe('development server handoff', () => {
  test.each([
    ['localhost', 'http://localhost:43127/'],
    ['IPv4 loopback', 'http://127.0.0.1:43128/'],
    ['IPv6 loopback', 'http://[::1]:43129/'],
  ])('accepts a %s URL with an explicit port', (_label, url) => {
    expect(
      getDevServerUrlFromCommandLine(['electron.exe', '.', `${DEV_SERVER_URL_SWITCH}=${url}`]),
    ).toBe(url);
  });

  test.each([
    'https://localhost:43127/',
    'http://example.com:43127/',
    'http://localhost/',
    'http://user:secret@localhost:43127/',
    'http://localhost:43127/settings',
    'http://localhost:43127/?token=secret',
    'not-a-url',
  ])('rejects an unsafe or malformed URL: %s', url => {
    expect(getDevServerUrlFromCommandLine([`${DEV_SERVER_URL_SWITCH}=${url}`])).toBeNull();
  });

  test('returns null when the handoff switch is absent', () => {
    expect(getDevServerUrlFromCommandLine(['electron.exe', '.'])).toBeNull();
  });
});
