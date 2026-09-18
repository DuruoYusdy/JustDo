import fs from 'fs';
import os from 'os';
import path from 'path';

import { PRODUCT_NAME } from '../../../shared/productMetadata';

export const MULTICA_COMMAND_NAME = `${PRODUCT_NAME}-agent`;
const OWNERSHIP_MARKER = `${PRODUCT_NAME}-managed-multica-launcher-v2`;

export interface MulticaCommandLauncher {
  command: string;
  path: string;
}

export function resolvePackagedMulticaTargetPath(
  execPath: string,
  platform: NodeJS.Platform = process.platform,
  appImagePath: string | undefined = process.env.APPIMAGE,
): string {
  const stableAppImage = platform === 'linux' ? appImagePath?.trim() : undefined;
  return path.resolve(stableAppImage || execPath);
}

interface LauncherOptions {
  targetPath: string;
  targetArgs?: readonly string[];
  platform?: NodeJS.Platform;
  pathValue?: string;
  homeDirectory?: string;
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

const launcherContent = (targetPath: string, targetArgs: readonly string[]): string =>
  [
    '#!/bin/sh',
    `# ${OWNERSHIP_MARKER}`,
    'unset ELECTRON_RUN_AS_NODE NODE_ENV NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH OPENCLAW_STATE_DIR OPENCLAW_HOME OPENCLAW_GATEWAY_URL OPENCLAW_GATEWAY_TOKEN OPENCLAW_GATEWAY_PASSWORD OPENCLAW_GATEWAY_PORT',
    "for _justdo_env_name in $(env | sed -n 's/^\\([A-Za-z_][A-Za-z0-9_]*\\)=.*/\\1/p'); do",
    '  case "$_justdo_env_name" in JUSTDO_*|ELECTRON_*|OPENCLAW_BUNDLED_*) unset "$_justdo_env_name" ;; esac',
    'done',
    `exec ${[targetPath, ...targetArgs].map(shellQuote).join(' ')} "$@"`,
    '',
  ].join('\n');

const isWithinDirectory = (root: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
};

export function ensureMulticaCommandLauncher(options: LauncherOptions): MulticaCommandLauncher {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    const target = path.resolve(options.targetPath);
    if (path.extname(target).toLocaleLowerCase('en-US') !== '.exe') {
      throw new Error('Multica requires a native executable on Windows.');
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error('The Multica Agent launcher was not found.');
    }
    return { command: target.replaceAll('\\', '/'), path: target };
  }

  const home = options.homeDirectory ?? os.homedir();
  const realHome = fs.realpathSync(home);
  const preferredDirectory = path.join(home, '.local', 'bin');
  const pathDirectories = (options.pathValue ?? process.env.PATH ?? '')
    .split(path.delimiter)
    .map(value => value.trim())
    .filter(Boolean);
  const candidates = [preferredDirectory, ...pathDirectories].filter(
    (value, index, all) => all.indexOf(value) === index && isWithinDirectory(home, value),
  );
  const content = launcherContent(options.targetPath, options.targetArgs ?? []);
  for (const directory of candidates) {
    try {
      fs.mkdirSync(directory, { recursive: directory === preferredDirectory });
      if (!isWithinDirectory(realHome, fs.realpathSync(directory))) continue;
      fs.accessSync(directory, fs.constants.W_OK);
      const launcherPath = path.join(directory, MULTICA_COMMAND_NAME);
      if (fs.existsSync(launcherPath)) {
        const current = fs.readFileSync(launcherPath, 'utf8');
        if (current !== content && !current.includes(OWNERSHIP_MARKER)) continue;
      }
      const temporaryPath = `${launcherPath}.${process.pid}.tmp`;
      fs.rmSync(temporaryPath, { force: true });
      fs.writeFileSync(temporaryPath, content, { mode: 0o700, flag: 'wx' });
      fs.rmSync(launcherPath, { force: true });
      fs.renameSync(temporaryPath, launcherPath);
      fs.chmodSync(launcherPath, 0o700);
      return { command: launcherPath, path: launcherPath };
    } catch {
      // Try the next user-owned PATH entry.
    }
  }
  throw new Error('No writable user-owned PATH directory is available for the Multica launcher.');
}

export function removeMulticaCommandLauncher(
  launcherPath: string,
  platform: NodeJS.Platform = process.platform,
  homeDirectory: string = os.homedir(),
): void {
  if (platform === 'win32' || !fs.existsSync(launcherPath)) return;
  if (path.basename(launcherPath) !== MULTICA_COMMAND_NAME) return;
  if (fs.lstatSync(launcherPath).isSymbolicLink()) return;
  const realHome = fs.realpathSync(homeDirectory);
  if (!isWithinDirectory(realHome, fs.realpathSync(launcherPath))) return;
  const content = fs.readFileSync(launcherPath, 'utf8');
  if (content.includes(OWNERSHIP_MARKER)) fs.rmSync(launcherPath, { force: true });
}
