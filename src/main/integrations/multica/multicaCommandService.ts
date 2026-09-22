import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { ScheduledTaskAgentId } from '../../../shared/scheduledTask/constants';
import { resolveTaskWorkingDirectory } from '../../core/filesystem/taskWorkspace';
import type { Agent, CoworkStore } from '../../data/coworkStore';
import { MulticaExternalSessionStore } from './multicaExternalSessionStore';

export interface MulticaCommandResult {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

interface MulticaCommandServiceOptions {
  getCoworkStore: () => CoworkStore;
  getExternalSessionStore: () => MulticaExternalSessionStore;
  getConfigPath: () => string;
  getOpenClawVersion: () => string | null;
  runOpenClaw: (
    argv: string[],
    cwd: string,
    env: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<MulticaCommandResult>;
  waitForConfigUpdates: () => Promise<void>;
  isEnabled: () => boolean;
  onSessionsChanged: () => void;
}

interface AgentInvocation {
  sessionKey: string;
  prompt: string;
  agentId: string;
}

const MAX_SESSION_KEY_LENGTH = 256;
const MAX_PROMPT_LENGTH = 8 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const formatSuccessfulAgentOutput = (stdout: string | undefined): string | undefined => {
  const source = stdout?.trim();
  if (!source) return undefined;

  let envelope: JsonRecord;
  try {
    envelope = asRecord(JSON.parse(source)) ?? {};
  } catch {
    throw new Error('The Agent returned an invalid response.');
  }

  const nestedResult = asRecord(envelope.result);
  const rawPayloads = Array.isArray(nestedResult?.payloads)
    ? nestedResult.payloads
    : Array.isArray(envelope.payloads)
      ? envelope.payloads
      : null;
  if (!rawPayloads) throw new Error('The Agent response did not contain any reply payloads.');

  const parts: string[] = [];
  for (const rawPayload of rawPayloads) {
    const payload = asRecord(rawPayload);
    if (!payload) continue;
    if (typeof payload.text === 'string' && payload.text.trim()) {
      parts.push(payload.text.trimEnd());
    }
    const mediaUrls = [
      ...(Array.isArray(payload.mediaUrls)
        ? payload.mediaUrls.filter((value): value is string => typeof value === 'string')
        : []),
      ...(typeof payload.mediaUrl === 'string' ? [payload.mediaUrl] : []),
    ];
    for (const mediaUrl of new Set(mediaUrls.map(value => value.trim()).filter(Boolean))) {
      parts.push(`Attachment: ${mediaUrl}`);
    }
  }
  return parts.length > 0 ? `${parts.join('\n')}\n` : undefined;
};

const agentFailure = (message: string, exitCode: number): MulticaCommandResult => ({
  stdout: `${JSON.stringify({ type: 'error', message })}\n`,
  stderr: `${message}\n`,
  exitCode,
});

const readOption = (argv: readonly string[], name: string): string | undefined => {
  const direct = argv.find(value => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const parseAgentInvocation = (argv: readonly string[]): AgentInvocation => {
  const prompt = readOption(argv, '--message') ?? '';
  const sessionKey = readOption(argv, '--session-id') ?? readOption(argv, '--session-key') ?? '';
  const agentId = (readOption(argv, '--agent') ?? 'main').trim();
  if (!prompt.trim()) throw new Error('Multica did not provide a task prompt.');
  if (prompt.length > MAX_PROMPT_LENGTH) throw new Error('The Multica task prompt is too large.');
  if (
    !sessionKey.trim() ||
    sessionKey.length > MAX_SESSION_KEY_LENGTH ||
    /[\r\n]/.test(sessionKey)
  ) {
    throw new Error('Multica provided an invalid session id.');
  }
  if (!agentId || agentId.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(agentId)) {
    throw new Error('Multica selected an invalid Agent id.');
  }
  return { prompt, sessionKey: sessionKey.trim(), agentId };
};

const canonicalizePath = (value: string): string => fs.realpathSync.native(path.resolve(value));

const buildSessionTitle = (prompt: string): string => {
  const userMessageMarker = /(?:^|\r?\n)User message:\s*\r?\n/g;
  let match: RegExpExecArray | null;
  let messageStart = -1;
  while ((match = userMessageMarker.exec(prompt)) !== null) {
    messageStart = match.index + match[0].length;
  }
  const candidate = messageStart >= 0 ? prompt.slice(messageStart) : prompt;
  const message = candidate.split(/\r?\n\r?\n## Task Initiator(?:\r?\n|$)/u, 1)[0] ?? candidate;
  const firstLine = message
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(Boolean);
  return firstLine?.replace(/^#{1,6}\s+/u, '').slice(0, 50) || 'Multica task';
};

export const buildMulticaOpenClawSessionKey = (
  agentId: string,
  externalSessionKey: string,
): string => {
  const digest = createHash('sha256')
    .update(`${agentId}\0${externalSessionKey}`)
    .digest('base64url')
    .slice(0, 24)
    .toLowerCase();
  return `agent:${agentId}:multica:${digest}`.toLowerCase();
};

const validateTaskEnvironment = (env: Record<string, string>): string | null => {
  if (!env.MULTICA_TOKEN?.startsWith('mat_')) return 'Multica did not provide task-scoped auth.';
  // Current Multica runtimes do not always export MULTICA_WORKSPACES_ROOT. The
  // separately validated absolute cwd is the authoritative task workspace.
  for (const name of [
    'MULTICA_TASK_CONFIG_ROOT',
    'MULTICA_SERVER_URL',
    'MULTICA_WORKSPACE_ID',
    'MULTICA_AGENT_ID',
    'MULTICA_TASK_ID',
  ]) {
    if (!env[name]?.trim()) return `Multica did not provide ${name}.`;
  }
  const configPath = env.OPENCLAW_CONFIG_PATH;
  if (!configPath || !path.isAbsolute(configPath)) {
    return 'Multica did not provide an isolated OpenClaw task config.';
  }
  try {
    if (!fs.statSync(configPath).isFile()) throw new Error('not a file');
  } catch {
    return 'The Multica OpenClaw task config is unavailable.';
  }
  return null;
};

const rewriteSessionArgv = (argv: readonly string[], sessionKey: string): string[] => {
  const rewritten = argv.filter(value => value !== '--local');
  const inlineIndex = rewritten.findIndex(
    value => value.startsWith('--session-id=') || value.startsWith('--session-key='),
  );
  if (inlineIndex >= 0) {
    rewritten[inlineIndex] = `--session-key=${sessionKey}`;
  } else {
    const index = Math.max(rewritten.indexOf('--session-id'), rewritten.indexOf('--session-key'));
    if (index < 0) throw new Error('Multica agent request is missing a session identifier.');
    rewritten.splice(index, 2, '--session-key', sessionKey);
  }
  return rewritten;
};

export class MulticaCommandService {
  private readonly activeExternalSessions = new Set<string>();

  constructor(private readonly options: MulticaCommandServiceOptions) {}

  get activeTaskCount(): number {
    return this.activeExternalSessions.size;
  }

  async execute(
    argv: string[],
    cwd: string,
    env: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<MulticaCommandResult> {
    if (!this.options.isEnabled()) {
      return { stderr: 'Multica integration is disabled.\n', exitCode: 69 };
    }
    if (argv.length === 1 && argv[0] === '--version') {
      const version = this.options.getOpenClawVersion() ?? '2026.9.2';
      return { stdout: `openclaw ${version}\n`, exitCode: 0 };
    }
    if (argv[0] === 'config' && argv[1] === 'validate') {
      return {
        stdout: `${JSON.stringify({ valid: true, path: this.options.getConfigPath(), warnings: [] })}\n`,
        exitCode: 0,
      };
    }
    if (argv[0] === 'config' && argv[1] === 'file') {
      return { stdout: `${this.options.getConfigPath()}\n`, exitCode: 0 };
    }
    if (argv[0] === 'config' && argv[1] === 'get') {
      return { stderr: 'Config path not found: agents.list\n', exitCode: 1 };
    }
    if (argv[0] === 'agents' && argv[1] === 'list') {
      const agents = this.options
        .getCoworkStore()
        .listAgents()
        .filter(agent => agent.enabled && agent.id !== ScheduledTaskAgentId)
        .map(agent => ({ id: agent.id, name: agent.name || agent.id, model: agent.model }));
      return { stdout: `${JSON.stringify(agents, null, 2)}\n`, exitCode: 0 };
    }
    if (argv[0] !== 'agent') {
      return { stderr: 'Unsupported Multica compatibility command.\n', exitCode: 64 };
    }
    let invocation: AgentInvocation;
    try {
      invocation = parseAgentInvocation(argv);
    } catch (error) {
      return agentFailure(error instanceof Error ? error.message : String(error), 64);
    }
    return this.executeAgent(argv, invocation, cwd, env, signal);
  }

  private async executeAgent(
    argv: string[],
    invocation: AgentInvocation,
    cwd: string,
    env: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<MulticaCommandResult> {
    if (this.activeExternalSessions.has(invocation.sessionKey)) {
      return agentFailure('This Multica session already has an active task.', 75);
    }
    let resolvedCwd: string;
    try {
      if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('invalid cwd');
      resolvedCwd = resolveTaskWorkingDirectory(canonicalizePath(cwd));
    } catch {
      return agentFailure('Multica provided an invalid task working directory.', 64);
    }
    const coworkStore = this.options.getCoworkStore();
    const agent = coworkStore.getAgent(invocation.agentId);
    if (!agent || !agent.enabled || agent.id === ScheduledTaskAgentId) {
      return agentFailure(`The selected Agent "${invocation.agentId}" is unavailable.`, 64);
    }
    const environmentError = validateTaskEnvironment(env);
    if (environmentError) return agentFailure(environmentError, 78);

    this.activeExternalSessions.add(invocation.sessionKey);
    this.options.onSessionsChanged();
    try {
      return await this.executeReservedAgent(
        argv,
        invocation,
        resolvedCwd,
        env,
        coworkStore,
        agent,
        signal,
      );
    } catch (error) {
      return agentFailure(error instanceof Error ? error.message : String(error), 1);
    } finally {
      this.activeExternalSessions.delete(invocation.sessionKey);
      this.options.onSessionsChanged();
    }
  }

  private async executeReservedAgent(
    argv: string[],
    invocation: AgentInvocation,
    resolvedCwd: string,
    env: Record<string, string>,
    coworkStore: CoworkStore,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<MulticaCommandResult> {
    await this.options.waitForConfigUpdates();
    const externalStore = this.options.getExternalSessionStore();
    const openclawSessionKey = buildMulticaOpenClawSessionKey(
      invocation.agentId,
      invocation.sessionKey,
    );
    let external = externalStore.get(invocation.sessionKey);
    if (external) {
      let externalCwd: string;
      try {
        externalCwd = canonicalizePath(external.cwd);
      } catch {
        return agentFailure('The linked task working directory no longer exists.', 66);
      }
      if (externalCwd !== resolvedCwd) {
        return agentFailure('A resumed Multica session cannot change its working directory.', 64);
      }
      if (external.agentId !== invocation.agentId) {
        return agentFailure('A resumed Multica session cannot change its Agent.', 64);
      }
      if (!coworkStore.getSession(external.coworkSessionId)) {
        return agentFailure('The linked local session no longer exists.', 66);
      }
      if (!external.openclawSessionKey) {
        externalStore.setOpenClawSessionKey(invocation.sessionKey, openclawSessionKey);
        external = { ...external, openclawSessionKey };
      }
    } else {
      if (externalStore.wasDeleted(invocation.sessionKey)) {
        return agentFailure('The linked local session was deleted and cannot be resumed.', 66);
      }
      const config = coworkStore.getConfig();
      const title = buildSessionTitle(invocation.prompt);
      const session = coworkStore.createSession(
        title,
        resolvedCwd,
        'local',
        [],
        agent.id,
        config.permissionMode,
        agent.id === 'main' ? undefined : agent.model.trim() || undefined,
      );
      try {
        external = externalStore.create({
          externalSessionKey: invocation.sessionKey,
          coworkSessionId: session.id,
          agentId: agent.id,
          openclawSessionKey,
          cwd: resolvedCwd,
        });
      } catch (error) {
        coworkStore.deleteSession(session.id);
        throw error;
      }
    }

    externalStore.setStatus(invocation.sessionKey, 'running');
    coworkStore.updateSession(external.coworkSessionId, { status: 'running' });
    this.options.onSessionsChanged();
    const startedAt = Date.now();
    const clientTurnId = `justdo-${startedAt}-${randomUUID()}`;
    let runTiming;
    try {
      runTiming = coworkStore.beginSessionRun({
        sessionId: external.coworkSessionId,
        clientTurnId,
        startedAt,
        modelRef: agent.id === 'main' ? undefined : agent.model.trim() || undefined,
      });
    } catch (error) {
      externalStore.setStatus(invocation.sessionKey, 'error');
      coworkStore.updateSession(external.coworkSessionId, { status: 'error' });
      throw error;
    }
    try {
      if (signal?.aborted) {
        externalStore.setStatus(invocation.sessionKey, 'cancelled');
        coworkStore.updateSession(external.coworkSessionId, { status: 'idle' });
        coworkStore.finishSessionRun(runTiming.id, 'aborted', Date.now());
        return agentFailure('Multica task was cancelled.', 130);
      }
      const result = await this.options.runOpenClaw(
        rewriteSessionArgv(argv, external.openclawSessionKey || openclawSessionKey),
        resolvedCwd,
        env,
        signal,
      );
      if (signal?.aborted || result.exitCode === 130) {
        externalStore.setStatus(invocation.sessionKey, 'cancelled');
        coworkStore.updateSession(external.coworkSessionId, { status: 'idle' });
        coworkStore.finishSessionRun(runTiming.id, 'aborted', Date.now());
        return result.stdout?.trim()
          ? { ...result, exitCode: 130 }
          : {
              ...agentFailure('Multica task was cancelled.', 130),
              stderr: result.stderr || 'Multica task was cancelled.\n',
            };
      }
      if (result.exitCode !== 0) {
        externalStore.setStatus(invocation.sessionKey, 'error');
        coworkStore.updateSession(external.coworkSessionId, { status: 'error' });
        coworkStore.finishSessionRun(runTiming.id, 'failed', Date.now());
        if (result.stdout?.trim()) return result;
        const message = result.stderr?.trim() || `OpenClaw exited with code ${result.exitCode}.`;
        return {
          ...agentFailure(message, result.exitCode),
          stderr: result.stderr || `${message}\n`,
        };
      }
      const stdout = formatSuccessfulAgentOutput(result.stdout);
      externalStore.setStatus(invocation.sessionKey, 'completed');
      coworkStore.updateSession(external.coworkSessionId, { status: 'completed' });
      coworkStore.finishSessionRun(runTiming.id, 'completed', Date.now());
      return { ...result, stdout };
    } catch (error) {
      const cancelled = signal?.aborted === true;
      externalStore.setStatus(invocation.sessionKey, cancelled ? 'cancelled' : 'error');
      coworkStore.updateSession(external.coworkSessionId, {
        status: cancelled ? 'idle' : 'error',
      });
      coworkStore.finishSessionRun(runTiming.id, cancelled ? 'aborted' : 'failed', Date.now());
      const message = error instanceof Error ? error.message : String(error);
      return agentFailure(message, cancelled ? 130 : 1);
    }
  }
}
