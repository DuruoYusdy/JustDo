import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, it } from 'vitest';

import { runMulticaOpenClaw } from './multicaOpenClawRunner';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createScript = (body: string): { cwd: string; script: string } => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-multica-runner-'));
  temporaryDirectories.push(cwd);
  const script = path.join(cwd, 'runtime.cjs');
  fs.writeFileSync(script, body);
  return { cwd, script };
};

it('runs the locked OpenClaw entry without allowing task env to redirect the Gateway', async () => {
  const { cwd, script } = createScript(`
    process.stdout.write(JSON.stringify({
      argv: process.argv.slice(2),
      token: process.env.MULTICA_TOKEN,
      config: process.env.OPENCLAW_CONFIG_PATH,
      state: process.env.OPENCLAW_STATE_DIR,
      gatewayUrl: process.env.OPENCLAW_GATEWAY_URL,
      gatewayPort: process.env.OPENCLAW_GATEWAY_PORT,
      gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
      gatewayPassword: process.env.OPENCLAW_GATEWAY_PASSWORD,
      path: process.env.PATH
    }));
  `);
  const result = await runMulticaOpenClaw(
    {
      buildCliEnvironment: async () => ({
        openclawEntry: script,
        env: {
          JUSTDO_ELECTRON_PATH: process.execPath,
          OPENCLAW_CONFIG_PATH: path.join(cwd, 'app-config.json'),
          OPENCLAW_STATE_DIR: path.join(cwd, 'app-state'),
          OPENCLAW_GATEWAY_PORT: '42872',
          OPENCLAW_GATEWAY_TOKEN: 'app-gateway-token',
          PATH: path.join(cwd, 'runtime-bin'),
        },
      }),
    },
    ['agent', '--local', '--json'],
    cwd,
    {
      MULTICA_TOKEN: 'mat_task',
      OPENCLAW_CONFIG_PATH: path.join(cwd, 'task-config.json'),
      OPENCLAW_STATE_DIR: path.join(cwd, 'untrusted-task-state'),
      OPENCLAW_GATEWAY_URL: 'wss://untrusted.example',
      OPENCLAW_GATEWAY_PORT: '12345',
      OPENCLAW_GATEWAY_TOKEN: 'untrusted-task-token',
      OPENCLAW_GATEWAY_PASSWORD: 'untrusted-task-password',
      PATH: path.join(cwd, 'multica-bin'),
    },
  );

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout ?? '')).toEqual({
    argv: ['agent', '--local', '--json'],
    token: 'mat_task',
    config: path.join(cwd, 'app-config.json'),
    state: path.join(cwd, 'app-state'),
    gatewayPort: '42872',
    gatewayToken: 'app-gateway-token',
    path: [path.join(cwd, 'multica-bin'), path.join(cwd, 'runtime-bin')].join(path.delimiter),
  });
});

it('terminates the CLI request when the bridge request is cancelled', async () => {
  const { cwd, script } = createScript('setInterval(() => undefined, 1000);');
  const controller = new AbortController();
  const running = runMulticaOpenClaw(
    {
      buildCliEnvironment: async () => ({
        openclawEntry: script,
        env: { JUSTDO_ELECTRON_PATH: process.execPath },
      }),
    },
    ['agent'],
    cwd,
    {},
    controller.signal,
  );
  controller.abort();

  await expect(running).resolves.toMatchObject({ exitCode: 130 });
});

it('fails closed when the runtime exceeds its bounded output budget', async () => {
  const { cwd, script } = createScript("process.stdout.write('x'.repeat(4096));");

  await expect(
    runMulticaOpenClaw(
      {
        buildCliEnvironment: async () => ({
          openclawEntry: script,
          env: { JUSTDO_ELECTRON_PATH: process.execPath },
        }),
        maxOutputBytes: 32,
      },
      ['agent'],
      cwd,
      {},
    ),
  ).rejects.toThrow('too much output');
});
