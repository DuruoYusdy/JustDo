import { describe, expect, it } from 'vitest';

import {
  decodeMulticaBridgeLines,
  encodeMulticaBridgeMessage,
  MULTICA_BRIDGE_PROTOCOL_VERSION,
  parseMulticaBridgeArgv,
  sanitizeMulticaBridgeEnvironment,
  validateMulticaCommandArgv,
} from './multicaBridgeProtocol';

describe('Multica bridge protocol', () => {
  it('accepts every command used by Multica v0.4.43 discovery', () => {
    expect(validateMulticaCommandArgv(['config', 'validate', '--json'])).toEqual([
      'config',
      'validate',
      '--json',
    ]);
    expect(validateMulticaCommandArgv(['config', 'file'])).toEqual(['config', 'file']);
    expect(validateMulticaCommandArgv(['config', 'get', 'agents.list', '--json'])).toEqual([
      'config',
      'get',
      'agents.list',
      '--json',
    ]);
    expect(validateMulticaCommandArgv(['agents', 'list', '--json'])).toEqual([
      'agents',
      'list',
      '--json',
    ]);
  });

  it.each([true, false])('accepts an agent request with local mode=%s', local => {
    const argv = [
      'agent',
      ...(local ? ['--local'] : []),
      '--json',
      '--session-id',
      'multica-1',
      '--agent',
      'main',
      '--message',
      'line one\nline two',
    ];
    expect(parseMulticaBridgeArgv(['electron', '--justdo-multica-bridge', ...argv])).toEqual(argv);
  });

  it('rejects unrelated commands and line breaks outside the prompt', () => {
    expect(validateMulticaCommandArgv(['gateway', 'status'])).toBeNull();
    expect(
      validateMulticaCommandArgv([
        'agent',
        '--json',
        '--session-id',
        'bad\nid',
        '--message',
        'task',
      ]),
    ).toBeNull();
  });

  it('requires the private launcher marker for process-level dispatch', () => {
    expect(parseMulticaBridgeArgv(['app', '--version'])).toBeNull();
    expect(parseMulticaBridgeArgv(['app', '--justdo-multica-bridge', '--version'])).toEqual([
      '--version',
    ]);
  });

  it('accepts current safe options and rejects unknown, duplicate, or ambiguous agent flags', () => {
    expect(
      validateMulticaCommandArgv([
        'agent',
        '--json',
        '--session-id=multica-1',
        '--agent=main',
        '--message=task',
      ]),
    ).toEqual(['agent', '--json', '--session-id=multica-1', '--agent=main', '--message=task']);
    expect(
      validateMulticaCommandArgv([
        'agent',
        '--json',
        '--session-id',
        'one',
        '--message',
        'task',
        '--channel',
        'web',
        '--thinking=high',
        '--verbose',
        'on',
      ]),
    ).toEqual([
      'agent',
      '--json',
      '--session-id',
      'one',
      '--message',
      'task',
      '--channel',
      'web',
      '--thinking=high',
      '--verbose',
      'on',
    ]);
    expect(
      validateMulticaCommandArgv([
        'agent',
        '--json',
        '--session-id',
        'one',
        '--message',
        'task',
        '--unknown',
      ]),
    ).toBeNull();
    expect(
      validateMulticaCommandArgv([
        'agent',
        '--json',
        '--session-id',
        'one',
        '--session-id',
        'two',
        '--message',
        'task',
      ]),
    ).toBeNull();
    expect(
      validateMulticaCommandArgv([
        'agent',
        '--json',
        '--session-id',
        'one',
        '--session-key',
        'two',
        '--message',
        'task',
      ]),
    ).toBeNull();
    expect(
      validateMulticaCommandArgv([
        'agent',
        '--json',
        '--session-id',
        'one',
        '--message=first line\nsecond line',
      ]),
    ).not.toBeNull();
    expect(
      validateMulticaCommandArgv([
        'agent',
        '--json',
        '--session-id',
        'one',
        '--message',
        '--explain this prompt',
      ]),
    ).not.toBeNull();
  });

  it('round-trips newline-delimited messages while retaining a partial frame', () => {
    const frame = encodeMulticaBridgeMessage({
      type: 'exit',
      code: 0,
    });
    const decoded = decodeMulticaBridgeLines(`${frame}{"type":"exit"`);
    expect(decoded.messages).toEqual([{ type: 'exit', code: 0 }]);
    expect(decoded.remainder).toBe('{"type":"exit"');
    expect(MULTICA_BRIDGE_PROTOCOL_VERSION).toBe(3);
  });

  it('forwards task custom env while protecting the JustDo runtime bootstrap', () => {
    expect(
      sanitizeMulticaBridgeEnvironment({
        MULTICA_TOKEN: 'mat_task',
        MULTICA_TASK_ID: 'task-1',
        OPENCLAW_CONFIG_PATH: 'C:\\task\\openclaw.json',
        PATH: 'C:\\multica',
        CUSTOM_ACCESS_TOKEN: 'agent-configured',
        NODE_ENV: 'development',
        NODE_OPTIONS: '--require=untrusted.cjs',
        LD_PRELOAD: '/tmp/untrusted.so',
        DYLD_INSERT_LIBRARIES: '/tmp/untrusted.dylib',
        JUSTDO_ELECTRON_PATH: 'untrusted.exe',
        OPENCLAW_STATE_DIR: 'untrusted-state',
        OPENCLAW_GATEWAY_URL: 'wss://untrusted.example',
        OPENCLAW_GATEWAY_TOKEN: 'untrusted-token',
        OPENCLAW_GATEWAY_PASSWORD: 'untrusted-password',
        OPENCLAW_GATEWAY_PORT: '12345',
      }),
    ).toEqual({
      MULTICA_TOKEN: 'mat_task',
      MULTICA_TASK_ID: 'task-1',
      OPENCLAW_CONFIG_PATH: 'C:\\task\\openclaw.json',
      PATH: 'C:\\multica',
      CUSTOM_ACCESS_TOKEN: 'agent-configured',
    });
  });

  it('rejects malformed timeout values', () => {
    expect(
      validateMulticaCommandArgv([
        'agent',
        '--json',
        '--session-id',
        'one',
        '--timeout',
        'forever',
        '--message',
        'task',
      ]),
    ).toBeNull();
  });
});
