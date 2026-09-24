import { expect, test } from 'vitest';

import { parseSessionRetentionMs } from './retention';

test.each([
  ['7d', 604_800_000],
  ['1h30m', 5_400_000],
  [' 12H ', 43_200_000],
  ['2', 7_200_000],
  ['0h', 0],
  ['0.5d', 43_200_000],
  ['2m500ms', 120_500],
  ['', null],
  ['1h 30m', null],
  ['-1d', null],
  ['1dgarbage', null],
  ['1h30', null],
] as const)('parses native retention value %s', (value, expected) => {
  expect(parseSessionRetentionMs(value)).toBe(expected);
});
