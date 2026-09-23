import fs from 'fs';
import path from 'path';

import { t } from '../../core/i18n';

export type ExtensionConversionInput = {
  sourcePath: string;
  pluginDirectory: string;
};

const convertForeignExtension = async (
  _input: ExtensionConversionInput,
): Promise<ExtensionConversionInput> => {
  // TODO: Convert into an isolated temporary directory and return its install source.
  throw new Error(t('extensionConversionNotImplemented'));
};

/** Shared format boundary for local imports and downloaded marketplace extensions. */
export const prepareExtensionForInstall = async (
  input: ExtensionConversionInput,
): Promise<ExtensionConversionInput> => {
  // Detect the native format only. OpenClaw remains responsible for schema validation,
  // including malformed native manifests; they must not fall through to conversion.
  if (fs.existsSync(path.join(input.pluginDirectory, 'openclaw.plugin.json'))) {
    return input;
  }
  return convertForeignExtension(input);
};
