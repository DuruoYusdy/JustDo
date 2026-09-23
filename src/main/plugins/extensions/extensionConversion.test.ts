import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { t } from '../../core/i18n';
import { prepareExtensionForInstall } from './extensionConversion';

describe('prepareExtensionForInstall', () => {
  let pluginDirectory: string;

  beforeEach(() => {
    pluginDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-conversion-test-'));
  });

  afterEach(() => {
    fs.rmSync(pluginDirectory, { recursive: true, force: true });
  });

  it.each(['{"id":"native","configSchema":{}}', '{invalid json'])(
    'preserves the native source and leaves manifest validation to OpenClaw: %s',
    async manifest => {
      fs.writeFileSync(path.join(pluginDirectory, 'openclaw.plugin.json'), manifest);
      const input = { pluginDirectory, sourcePath: `${pluginDirectory}.tgz` };
      await expect(prepareExtensionForInstall(input)).resolves.toBe(input);
      expect(fs.readFileSync(path.join(pluginDirectory, 'openclaw.plugin.json'), 'utf8')).toBe(
        manifest,
      );
    },
  );

  it.each(['.claude-plugin', '.codex-plugin', '.cursor-plugin', 'unknown'])(
    'routes non-native %s packages to the conversion placeholder without changing files',
    async marker => {
      fs.mkdirSync(path.join(pluginDirectory, marker));
      await expect(
        prepareExtensionForInstall({ pluginDirectory, sourcePath: pluginDirectory }),
      ).rejects.toThrow(t('extensionConversionNotImplemented'));
      expect(fs.readdirSync(pluginDirectory)).toEqual([marker]);
    },
  );
});
