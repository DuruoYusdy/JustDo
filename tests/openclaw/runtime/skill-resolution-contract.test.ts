import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

const runtimeEntry = path.resolve('vendor/openclaw-runtime/current/openclaw.mjs');
const runtimeAvailable = fs.existsSync(runtimeEntry);
const temporaryRoots: string[] = [];

const writeSkill = (directory: string, description: string): void => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'SKILL.md'),
    `---\nname: duplicate-skill\ndescription: ${description}\n---\n`,
    'utf8',
  );
};

const createFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-skill-resolution-'));
  temporaryRoots.push(root);
  const stateDir = path.join(root, 'state');
  const workspaceDir = path.join(root, 'workspace');
  const bundledDir = path.join(root, 'bundled');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  return { root, stateDir, workspaceDir, bundledDir };
};

const writeConfig = (
  stateDir: string,
  workspaceDir: string,
  enabled: boolean | undefined,
): string => {
  const configPath = path.join(stateDir, 'openclaw.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      agents: { entries: { main: { workspace: workspaceDir } } },
      ...(enabled === undefined
        ? {}
        : { skills: { entries: { 'duplicate-skill': { enabled } } } }),
    }),
    'utf8',
  );
  return configPath;
};

const listSkills = (fixture: ReturnType<typeof createFixture>, enabled?: boolean) => {
  const configPath = writeConfig(fixture.stateDir, fixture.workspaceDir, enabled);
  const cliEnvironment = { ...process.env };
  delete cliEnvironment.VITEST;
  delete cliEnvironment.VITEST_POOL_ID;
  delete cliEnvironment.VITEST_WORKER_ID;
  const stdout = execFileSync(
    process.execPath,
    [runtimeEntry, 'skills', '--json', '--agent', 'main', 'list'],
    {
      cwd: fixture.workspaceDir,
      env: {
        ...cliEnvironment,
        OPENCLAW_STATE_DIR: fixture.stateDir,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_BUNDLED_SKILLS_DIR: fixture.bundledDir,
        NO_COLOR: '1',
      },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  return JSON.parse(stdout) as {
    skills: Array<{
      name: string;
      description: string;
      source: string;
      disabled?: boolean;
      eligible?: boolean;
    }>;
  };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(!runtimeAvailable)(
  'locked runtime keeps the workspace winner when the logical skill is disabled',
  () => {
  const fixture = createFixture();
  writeSkill(path.join(fixture.bundledDir, 'duplicate-skill'), 'Bundled variant');
  writeSkill(path.join(fixture.stateDir, 'skills', 'duplicate-skill'), 'Managed variant');
  writeSkill(path.join(fixture.workspaceDir, 'skills', 'duplicate-skill'), 'Workspace variant');

  const enabled = listSkills(fixture);
  const disabled = listSkills(fixture, false);

  expect(enabled.skills.filter(skill => skill.name === 'duplicate-skill')).toEqual([
    expect.objectContaining({ description: 'Workspace variant', source: 'openclaw-workspace' }),
  ]);
  expect(disabled.skills.filter(skill => skill.name === 'duplicate-skill')).toEqual([
    expect.objectContaining({
      description: 'Workspace variant',
      source: 'openclaw-workspace',
      disabled: true,
    }),
  ]);
  },
  60_000,
);

test.skipIf(!runtimeAvailable)('locked runtime resolves the next source only after the winner disappears', () => {
  const fixture = createFixture();
  const managedSkill = path.join(fixture.stateDir, 'skills', 'duplicate-skill');
  const workspaceSkill = path.join(fixture.workspaceDir, 'skills', 'duplicate-skill');
  writeSkill(managedSkill, 'Managed variant');
  writeSkill(workspaceSkill, 'Workspace variant');

  expect(
    listSkills(fixture).skills.find(skill => skill.name === 'duplicate-skill'),
  ).toMatchObject({ description: 'Workspace variant', source: 'openclaw-workspace' });

  fs.rmSync(workspaceSkill, { recursive: true });

  expect(
    listSkills(fixture).skills.find(skill => skill.name === 'duplicate-skill'),
  ).toMatchObject({ description: 'Managed variant', source: 'openclaw-managed' });
}, 60_000);

test.skipIf(!runtimeAvailable)(
  'locked runtime resolves the same skill name independently for each workspace',
  () => {
  const fixture = createFixture();
  const otherWorkspace = path.join(fixture.root, 'other-workspace');
  writeSkill(path.join(fixture.workspaceDir, 'skills', 'duplicate-skill'), 'First workspace');
  writeSkill(path.join(otherWorkspace, 'skills', 'duplicate-skill'), 'Second workspace');

  expect(
    listSkills(fixture).skills.find(skill => skill.name === 'duplicate-skill'),
  ).toMatchObject({ description: 'First workspace', source: 'openclaw-workspace' });
  expect(
    listSkills({ ...fixture, workspaceDir: otherWorkspace }).skills.find(
      skill => skill.name === 'duplicate-skill',
    ),
  ).toMatchObject({ description: 'Second workspace', source: 'openclaw-workspace' });
  },
  60_000,
);
