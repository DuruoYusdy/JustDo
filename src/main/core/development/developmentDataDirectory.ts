import path from 'path';

export function resolveDevelopmentDataDirectory(options: {
  isPackaged: boolean;
  nodeEnv?: string;
  directory?: string;
}): string | undefined {
  if (options.isPackaged || options.nodeEnv !== 'development' || !options.directory)
    return undefined;
  if (
    !path.isAbsolute(options.directory) ||
    path.parse(options.directory).root === path.resolve(options.directory)
  ) {
    throw new Error('JUSTDO_DEV_USER_DATA_DIR must be an absolute subdirectory.');
  }
  return path.resolve(options.directory);
}
