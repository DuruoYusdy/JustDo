import path from 'path';
import { expect, test } from 'vitest';

import { resolveDevelopmentDataDirectory } from './developmentDataDirectory';
test('isolates development data without changing packaged application paths', () => {
  const directory = path.resolve('开发测试 with spaces');
  expect(
    resolveDevelopmentDataDirectory({ isPackaged: false, nodeEnv: 'development', directory }),
  ).toBe(directory);
  expect(
    resolveDevelopmentDataDirectory({ isPackaged: true, nodeEnv: 'development', directory }),
  ).toBeUndefined();
  expect(
    resolveDevelopmentDataDirectory({ isPackaged: false, nodeEnv: 'production', directory }),
  ).toBeUndefined();
});
test('rejects ambiguous development data directories', () => {
  for (const directory of ['relative/path', path.parse(process.cwd()).root]) {
    expect(() =>
      resolveDevelopmentDataDirectory({ isPackaged: false, nodeEnv: 'development', directory }),
    ).toThrow();
  }
});
