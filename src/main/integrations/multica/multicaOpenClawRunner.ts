import { spawn } from 'child_process';
import path from 'path';

import type { MulticaCommandResult } from './multicaCommandService';

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

interface OpenClawCliEnvironment {
  env: NodeJS.ProcessEnv;
  openclawEntry: string;
}

interface MulticaOpenClawRunnerOptions {
  buildCliEnvironment: () => Promise<OpenClawCliEnvironment>;
  maxOutputBytes?: number;
}

const terminateProcessTree = (child: ReturnType<typeof spawn>): void => {
  if (!child.pid) {
    child.kill();
    return;
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
};

export async function runMulticaOpenClaw(
  options: MulticaOpenClawRunnerOptions,
  argv: string[],
  cwd: string,
  taskEnv: Record<string, string>,
  signal?: AbortSignal,
): Promise<MulticaCommandResult> {
  const cli = await options.buildCliEnvironment();
  if (signal?.aborted) {
    return { stderr: 'Multica task was cancelled.\n', exitCode: 130 };
  }
  const env: NodeJS.ProcessEnv = { ...cli.env, ...taskEnv };
  // The compatibility CLI must connect to this application's live Gateway.
  // Multica task variables may not redirect it to a second config/state or Gateway.
  for (const name of [
    'OPENCLAW_STATE_DIR',
    'OPENCLAW_CONFIG_PATH',
    'OPENCLAW_GATEWAY_URL',
    'OPENCLAW_GATEWAY_TOKEN',
    'OPENCLAW_GATEWAY_PASSWORD',
    'OPENCLAW_GATEWAY_PORT',
  ] as const) {
    const value = cli.env[name];
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  const taskPath = taskEnv.PATH || taskEnv.Path || '';
  const runtimePath = cli.env.PATH || cli.env.Path || '';
  env.PATH = [taskPath, runtimePath].filter(Boolean).join(path.delimiter);
  if (process.platform === 'win32') env.Path = env.PATH;
  env.ELECTRON_RUN_AS_NODE = '1';
  const executable = cli.env.JUSTDO_ELECTRON_PATH || process.execPath;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [cli.openclawEntry, ...argv], {
      cwd,
      detached: process.platform !== 'win32',
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let cancelled = signal?.aborted === true;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = (): void => {
      cancelled = true;
      terminateProcessTree(child);
    };
    const capture = (target: Buffer[], chunk: Buffer): void => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > (options.maxOutputBytes ?? MAX_OUTPUT_BYTES)) {
        terminateProcessTree(child);
        finish(() => reject(new Error('OpenClaw produced too much output.')));
        return;
      }
      target.push(chunk);
    };
    child.stdout?.on('data', (chunk: Buffer) => capture(stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => capture(stderr, chunk));
    child.once('error', error => finish(() => reject(error)));
    child.once('close', code =>
      finish(() =>
        resolve({
          ...(stdout.length ? { stdout: Buffer.concat(stdout).toString('utf8') } : {}),
          ...(stderr.length ? { stderr: Buffer.concat(stderr).toString('utf8') } : {}),
          exitCode: cancelled ? 130 : typeof code === 'number' ? code : 1,
        }),
      ),
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (cancelled) abort();
  });
}
