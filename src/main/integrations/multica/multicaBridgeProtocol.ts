import crypto from 'crypto';
import os from 'os';
import path from 'path';

export const MULTICA_BRIDGE_PROTOCOL_VERSION = 3;
export const MULTICA_BRIDGE_METADATA_FILE = 'bridge.json';
export const MULTICA_DEV_BRIDGE_SWITCH = '--justdo-multica-bridge';
export const MULTICA_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
export const MULTICA_BRIDGE_HANDSHAKE_TIMEOUT_MS = 10_000;
export const MULTICA_BRIDGE_MAX_CONNECTIONS = 32;

export interface MulticaBridgeMetadata {
  version: number;
  endpoint: string;
  token: string;
  pid: number;
}

export interface MulticaBridgeRequest {
  type: 'request';
  version: number;
  requestId: string;
  token: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}

export type MulticaBridgeResponse =
  | { type: 'stdout' | 'stderr'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };

const hasLineBreak = (value: string): boolean => /[\r\n]/.test(value);

const BLOCKED_BRIDGE_ENV_NAMES = new Set([
  'ELECTRON_RUN_AS_NODE',
  'NODE_ENV',
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'OPENCLAW_STATE_DIR',
  'OPENCLAW_HOME',
  'OPENCLAW_GATEWAY_URL',
  'OPENCLAW_GATEWAY_TOKEN',
  'OPENCLAW_GATEWAY_PASSWORD',
  'OPENCLAW_GATEWAY_PORT',
]);

const isAllowedBridgeEnvName = (name: string): boolean => {
  const upper = name.toUpperCase();
  return (
    /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) &&
    !upper.startsWith('JUSTDO_') &&
    !upper.startsWith('ELECTRON_') &&
    !upper.startsWith('OPENCLAW_BUNDLED_') &&
    !BLOCKED_BRIDGE_ENV_NAMES.has(upper)
  );
};

export function sanitizeMulticaBridgeEnvironment(
  env: NodeJS.ProcessEnv | Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (
      isAllowedBridgeEnvName(name) &&
      typeof value === 'string' &&
      value.length > 0 &&
      !value.includes('\0')
    ) {
      result[name] = value;
    }
  }
  return result;
}

const AGENT_STANDALONE_FLAGS = new Set(['--local', '--json', '--deliver']);
const AGENT_VALUE_FLAGS = new Set([
  '--session-id',
  '--session-key',
  '--timeout',
  '--agent',
  '--message',
  '--thinking',
  '--verbose',
  '--channel',
  '--reply-to',
  '--reply-channel',
  '--reply-account',
]);

const isAllowedAgentArgv = (argv: readonly string[]): boolean => {
  const seen = new Set<string>();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (hasLineBreak(token) && !token.startsWith('--message=')) return false;
    const equalsIndex = token.indexOf('=');
    const flag = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
    if (seen.has(flag)) return false;
    if (AGENT_STANDALONE_FLAGS.has(flag)) {
      if (equalsIndex >= 0) return false;
      seen.add(flag);
      continue;
    }
    if (!AGENT_VALUE_FLAGS.has(flag)) return false;
    const value = equalsIndex >= 0 ? token.slice(equalsIndex + 1) : argv[++index];
    if (
      value === undefined ||
      value === '' ||
      (flag !== '--message' && (hasLineBreak(value) || (equalsIndex < 0 && value.startsWith('--'))))
    ) {
      return false;
    }
    if (flag === '--timeout' && !/^[1-9]\d{0,5}$/.test(value)) return false;
    seen.add(flag);
  }
  return (
    seen.has('--json') &&
    seen.has('--message') &&
    seen.has('--session-id') !== seen.has('--session-key')
  );
};

export function validateMulticaCommandArgv(argv: readonly string[]): string[] | null {
  if (argv[0] !== 'agent' && argv.some(hasLineBreak)) return null;
  if (argv.length === 1 && argv[0] === '--version') return [...argv];

  if (argv[0] === 'config' && argv[1] === 'validate' && argv.length === 3 && argv[2] === '--json') {
    return [...argv];
  }
  if (argv[0] === 'config' && argv[1] === 'file' && argv.length === 2) return [...argv];
  if (
    argv[0] === 'config' &&
    argv[1] === 'get' &&
    argv[2] === 'agents.list' &&
    argv.length === 4 &&
    argv[3] === '--json'
  ) {
    return [...argv];
  }
  if (argv[0] === 'agents' && argv[1] === 'list' && argv.length === 3 && argv[2] === '--json') {
    return [...argv];
  }
  if (argv[0] === 'agent' && isAllowedAgentArgv(argv)) return [...argv];
  return null;
}

export function parseMulticaBridgeArgv(processArgv: readonly string[]): string[] | null {
  const markerIndex = processArgv.indexOf(MULTICA_DEV_BRIDGE_SWITCH);
  const argv = markerIndex >= 0 ? processArgv.slice(markerIndex + 1) : [];
  if (argv.length === 0) return null;
  return validateMulticaCommandArgv(argv);
}

export function getMulticaBridgeEndpoint(userDataPath: string): string {
  const suffix = crypto
    .createHash('sha256')
    .update(path.resolve(userDataPath))
    .digest('hex')
    .slice(0, 20);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\justdo-multica-${suffix}`
    : path.join(os.tmpdir(), `justdo-multica-${suffix}`, 'bridge.sock');
}

export function encodeMulticaBridgeMessage(
  message: MulticaBridgeRequest | MulticaBridgeResponse,
): string {
  return `${JSON.stringify(message)}\n`;
}

export function decodeMulticaBridgeLines(buffer: string): {
  messages: unknown[];
  remainder: string;
} {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  return {
    messages: lines.filter(Boolean).map(line => JSON.parse(line)),
    remainder,
  };
}
