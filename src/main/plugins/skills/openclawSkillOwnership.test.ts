import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import { PluginHubScope } from '../../../shared/plugins/management';
import type { GatewaySkillEntry } from '../../engine/types';
import { resolveSkillOwnershipScope } from './openclawSkillOwnership';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createPluginSkill = (baseDir: string): GatewaySkillEntry => ({
  name: 'Browser automation',
  description: 'Control browser pages.',
  source: 'openclaw-extra',
  bundled: false,
  filePath: path.join(baseDir, 'SKILL.md'),
  baseDir,
  skillKey: 'browser-automation',
  always: false,
  eligible: true,
  disabled: false,
  blockedByAllowlist: false,
  missing: { bins: [], env: [], config: [], os: [] },
  install: [],
  configChecks: [],
});

test('groups a skill from a bundled extension as system-owned', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-skill-owner-'));
  temporaryDirectories.push(fixtureRoot);
  const realRuntimeRoot = path.join(fixtureRoot, 'runtime-cache');
  const runtimeRoot = path.join(fixtureRoot, 'runtime-current');
  const skillDir = path.join(
    realRuntimeRoot,
    'dist',
    'extensions',
    'browser',
    'skills',
    'browser-automation',
  );
  fs.mkdirSync(skillDir, { recursive: true });
  fs.symlinkSync(realRuntimeRoot, runtimeRoot, 'junction');
  const publishedSkillDir = path.join(fixtureRoot, 'state', 'plugin-skills', 'browser-automation');
  fs.mkdirSync(path.dirname(publishedSkillDir), { recursive: true });
  fs.symlinkSync(skillDir, publishedSkillDir, 'junction');

  expect(
    resolveSkillOwnershipScope(createPluginSkill(publishedSkillDir), {
      getRuntimeRoot: () => runtimeRoot,
    }),
  ).toBe(PluginHubScope.SYSTEM);
});

test('keeps a skill from a user extension in the user-owned group', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-skill-owner-'));
  temporaryDirectories.push(fixtureRoot);
  const skillDir = path.join(fixtureRoot, 'state', 'extensions', 'custom', 'skills', 'example');
  fs.mkdirSync(skillDir, { recursive: true });
  const publishedSkillDir = path.join(fixtureRoot, 'state', 'plugin-skills', 'example');
  fs.mkdirSync(path.dirname(publishedSkillDir), { recursive: true });
  fs.symlinkSync(skillDir, publishedSkillDir, 'junction');

  expect(
    resolveSkillOwnershipScope(createPluginSkill(publishedSkillDir), {
      getRuntimeRoot: () => path.join(fixtureRoot, 'runtime'),
    }),
  ).toBe(PluginHubScope.PERSONAL);
});
