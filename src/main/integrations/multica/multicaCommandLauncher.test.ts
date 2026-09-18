import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureMulticaCommandLauncher,
  MULTICA_COMMAND_NAME,
  removeMulticaCommandLauncher,
  resolvePackagedMulticaTargetPath,
} from './multicaCommandLauncher';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Multica command launcher', () => {
  it('creates and removes an owned POSIX launcher using an absolute command path', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-launcher-'));
    temporaryDirectories.push(home);
    const launcher = ensureMulticaCommandLauncher({
      targetPath: '/opt/JustDo/JustDo',
      targetArgs: ['--justdo-multica-bridge'],
      platform: 'linux',
      homeDirectory: home,
      pathValue: '',
    });

    expect(launcher.command).toBe(launcher.path);
    expect(path.isAbsolute(launcher.command)).toBe(true);
    const content = fs.readFileSync(launcher.path, 'utf8');
    expect(content).toContain('unset ELECTRON_RUN_AS_NODE NODE_ENV NODE_OPTIONS NODE_PATH');
    expect(content).toContain('JUSTDO_*|ELECTRON_*|OPENCLAW_BUNDLED_*');
    expect(content).toContain("exec '/opt/JustDo/JustDo' '--justdo-multica-bridge' \"$@\"");
    if (process.platform !== 'win32') {
      expect(fs.statSync(launcher.path).mode & 0o700).toBe(0o700);
    }

    removeMulticaCommandLauncher(launcher.path, 'linux', home);
    expect(fs.existsSync(launcher.path)).toBe(false);
  });

  it('does not treat a sibling with the same path prefix as user-owned', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-launcher-'));
    temporaryDirectories.push(parent);
    const home = path.join(parent, 'user');
    const sibling = path.join(parent, 'user-other', 'bin');
    const preferred = path.join(home, '.local', 'bin');
    fs.mkdirSync(preferred, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(preferred, MULTICA_COMMAND_NAME), '#!/bin/sh\n# user-owned\n');

    expect(() =>
      ensureMulticaCommandLauncher({
        targetPath: '/opt/JustDo/JustDo',
        platform: 'linux',
        homeDirectory: home,
        pathValue: sibling,
      }),
    ).toThrow('No writable user-owned PATH directory');
    expect(fs.existsSync(path.join(sibling, MULTICA_COMMAND_NAME))).toBe(false);
  });

  it('does not remove a launcher-shaped file outside the user home', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-launcher-'));
    temporaryDirectories.push(parent);
    const home = path.join(parent, 'user');
    const outside = path.join(parent, 'outside');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    const owned = ensureMulticaCommandLauncher({
      targetPath: '/opt/JustDo/JustDo',
      platform: 'linux',
      homeDirectory: home,
      pathValue: '',
    });
    const candidate = path.join(outside, MULTICA_COMMAND_NAME);
    fs.copyFileSync(owned.path, candidate);

    removeMulticaCommandLauncher(candidate, 'linux', home);

    expect(fs.existsSync(candidate)).toBe(true);
  });

  it('uses the stable AppImage path instead of its temporary mount executable', () => {
    expect(
      resolvePackagedMulticaTargetPath(
        '/tmp/.mount_JustDo/usr/bin/justdo',
        'linux',
        '/home/user/Applications/JustDo.AppImage',
      ),
    ).toBe(path.resolve('/home/user/Applications/JustDo.AppImage'));
    expect(resolvePackagedMulticaTargetPath('/Applications/JustDo.app/JustDo', 'darwin')).toBe(
      path.resolve('/Applications/JustDo.app/JustDo'),
    );
  });
});
