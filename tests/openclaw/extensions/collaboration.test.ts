import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { buildSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const code = buildSync({ entryPoints: [path.resolve('openclaw-extensions/agent-team/index.ts')], bundle: true,
  platform: 'node', format: 'cjs', write: false, external: ['openclaw/plugin-sdk/*', 'typebox'] }).outputFiles[0].text;
const historyCode = buildSync({ entryPoints: [path.resolve('openclaw-extensions/runtime-services/collaboration-history.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['openclaw/plugin-sdk/*'] }).outputFiles[0].text;
function fixture(teamEnabled = true) {
  let plan = false;
  let nativeSessionId = 'native-target';
  let transcriptEntries: any[] = [];
  const providers: Array<(request: any) => unknown> = [];
  const hooks = new Map<string, (...args: any[]) => any>();
  const methods = new Map<string, (...args: any[]) => any>();
  const factories = new Map<string, (...args: any[]) => any>();
  const toolOptions = new Map<string, Record<string, unknown>>();
  let service: any;
  const exports: Record<string, any> = {};
  const moduleBox = { exports };
  const context = { exports, module: moduleBox, setTimeout, clearTimeout,
    require: (name: string) => name === 'typebox' ? { Type: new Proxy({}, { get: () => (...args: unknown[]) => args }) }
      : name === 'openclaw/plugin-sdk/routing' ? { isSubagentSessionKey: (key: string) => /^(?:agent:[^:]+:)?subagent:/i.test(key.trim()) }
      : name === 'openclaw/plugin-sdk/session-store-runtime' ? { getSessionEntry: () => ({ sessionId: nativeSessionId, justdoPlanMode: { enabled: plan } }) }
        : name === 'openclaw/plugin-sdk/codex-session-transcript-runtime' ? {
          withCodexSessionTranscriptMirrorWriteLock: vi.fn(async (target, run) => {
            if (target.sessionId !== nativeSessionId) throw new Error('Incorrect physical transcript ID');
            return run({
              readMessageFacts: async ({ idempotencyKeys }: { idempotencyKeys: string[] }) => ({
                anchorsByIdempotencyKey: new Map(transcriptEntries.flatMap((entry, index) =>
                  idempotencyKeys.includes(entry.idempotencyKey)
                    ? [[entry.idempotencyKey, { entryId: `entry-${index}` }]]
                    : [])),
              }),
            });
          }),
        }
        : name === 'openclaw/plugin-sdk/session-visibility' ? { createSessionVisibilityChecker: { registerScopedAccessProvider: (provider: (request: any) => unknown) => { providers.push(provider); return () => { const index = providers.indexOf(provider); if (index >= 0) providers.splice(index, 1); }; } } }
          : nativeRequire(name),
  };
  new vm.Script(code).runInNewContext(context);
  const historyModule = { exports: {} as Record<string, any> };
  new vm.Script(historyCode).runInNewContext({ ...context, exports: historyModule.exports, module: historyModule });
  const runtime = { config: { current: () => ({plugins: {entries: {'agent-team': {enabled: teamEnabled}}}}) }, gateway: { request: (name: string, params: unknown) => new Promise((resolve, reject) => {
    if (name === 'chat.message.get') {
      const index = Number(String((params as { messageId: string }).messageId).replace('entry-', ''));
      const message = transcriptEntries[index]?.message;
      resolve(message ? { ok: true, message } : { ok: false, unavailableReason: 'not_found' });
      return;
    }
    methods.get(name)!({ params, respond: (ok: boolean, result: unknown, error: { message: string }) => ok ? resolve(result) : reject(new Error(error.message)) });
  }) } };
  if (teamEnabled) moduleBox.exports.default.register({
    runtime,
    registerService: (value: any) => { service = value; },
    registerGatewayMethod: (name: string, callback: (...args: any[]) => any) => methods.set(name, callback),
    registerTool: () => undefined,
    on: (name: string, callback: (...args: any[]) => any) => hooks.set(name, callback),
  });
  // Production can materialize tool factories in a separate registration instance.
  if (teamEnabled) moduleBox.exports.default.register({
    runtime, registerService: () => undefined, registerGatewayMethod: () => undefined, on: () => undefined,
    registerTool: (factory: (...args: any[]) => any, options: { name: string }) => {
      factories.set(options.name, factory);
      toolOptions.set(options.name, options);
    },
  });
  const emit = vi.fn((_event, payload) => {
    methods.get('collaboration.resolve')!({ params: { requestId: payload.requestId, result: payload.operation === 'native-send' ? { deliveryId: 'receipt', sessionKey: payload.input.sessionKey } : { state: 'queued', messageId: 'receipt' } }, respond: vi.fn() });
  });
  historyModule.exports.registerCollaborationHistory({runtime, config: {plugins: {entries: {'agent-team': {enabled: teamEnabled}}}}, on: (name: string, callback: (...args: any[]) => any) => { const previous = hooks.get(name); hooks.set(name, async (...args) => (await callback(...args)) ?? previous?.(...args)); }, registerGatewayMethod: (name: string, callback: (...args: any[]) => any) => methods.set(name, callback)});
  service?.start({ gatewayEvents: { emit } });
  return { hooks, factories, toolOptions, emit, methods, providers,
    start: () => service?.start({ gatewayEvents: { emit } }),
    setTeamEnabled: (enabled: boolean) => { teamEnabled = enabled; },
    setNativeSessionId: (sessionId: string) => { nativeSessionId = sessionId; },
    setTranscriptEntries: (entries: any[]) => { transcriptEntries = entries; },
    setPlan: () => { plan = true; }, stop: () => service?.stop() };
}

describe('native peer tool authority', () => {
  it.each([true, false].flatMap(enabled => ['agent:main:subagent:child', 'subagent:child', ' AGENT:main:SUBAGENT:child '].map(key => [enabled, key] as const)))('leaves native SubAgent sends untouched with team enabled=%s and key=%s', async (enabled, key) => {
    const h = fixture(enabled);
    expect(await h.hooks.get('before_tool_call')!({toolName: 'sessions_send', params: {
      sessionKey: key, message: 'Additional task context', timeoutSeconds: 30,
    }}, {sessionKey: 'agent:main:justdo:a'})).toBeUndefined();
    expect(h.emit).not.toHaveBeenCalled();
    h.stop();
  });
  it.each([
    { sessionKey: 'agent:review:justdo:b' },
    { sessionKey: 'physical-session-id' },
    { label: 'review' },
    { agentId: 'review' },
  ])('does not bypass the disabled peer boundary with %j', async params => {
    const h = fixture(false);
    expect(await h.hooks.get('before_tool_call')!({toolName: 'sessions_send', params},
      {sessionKey: 'agent:main:justdo:a'})).toMatchObject({block: true});
  });
  it('restores scoped send access when the same service registration is restarted', async () => {
    const h = fixture();
    const ctx = {sessionKey: 'agent:main:justdo:a', runId: 'run', toolCallId: 'first'};
    const event = {toolName: 'sessions_send', params: {sessionKey: 'agent:review:justdo:b', message: 'Review'}};
    const access = {action: 'send', requesterSessionKey: ctx.sessionKey, targetSessionKey: event.params.sessionKey};
    expect(h.providers).toHaveLength(1);
    await h.hooks.get('before_tool_call')!(event, ctx);
    const previousProvider = h.providers[0];
    expect(previousProvider(access)).toEqual({expectedSessionId: 'native-target'});
    h.stop();
    expect(h.providers).toHaveLength(0);
    expect(previousProvider(access)).toBeUndefined();
    h.start();
    h.start();
    expect(h.providers).toHaveLength(1);
    expect(h.providers[0](access)).toBeUndefined();
    await h.hooks.get('before_tool_call')!(event, {...ctx, toolCallId: 'second'});
    expect(h.providers[0](access)).toEqual({expectedSessionId: 'native-target'});
    h.stop();
    expect(h.providers).toHaveLength(0);
  });

  it('blocks stale peer sends when disabled, without changing SubAgent spawning', async () => {
    const h = fixture(false);
    expect(await h.hooks.get('before_tool_call')!({toolName: 'sessions_send'}, {sessionKey: 'agent:main:justdo:a'})).toMatchObject({block: true});
    expect(await h.hooks.get('before_tool_call')!({toolName: 'sessions_spawn'}, {sessionKey: 'agent:main:justdo:a'})).toBeUndefined();
    h.setTeamEnabled(true);
    expect(await h.hooks.get('before_tool_call')!({toolName: 'sessions_send'}, {sessionKey: 'agent:main:justdo:a'})).toBeUndefined();
  });
  it('packages a discoverable skill without automatic prompt hooks', () => {
    const manifest = JSON.parse(readFileSync('openclaw-extensions/agent-team/openclaw.plugin.json', 'utf8'));
    expect(manifest.id).toBe('agent-team');
    expect(manifest.skills).toEqual(['./skills']);
    const skill = readFileSync('openclaw-extensions/agent-team/skills/agent-team/SKILL.md', 'utf8');
    expect(skill).toContain('name: agent-team');
    expect(skill).toContain('task_assistants');
    expect(skill).toContain('sessions_send');
  });
  it('does not inject team context into ordinary turns', () => {
    const h = fixture();
    expect(h.hooks.has('agent_turn_prepare')).toBe(false);
    expect(h.hooks.has('before_prompt_build')).toBe(false);
    h.stop();
  });
  it('keeps receipt history available without team tools or send grants', () => {
    const h = fixture(false);
    expect(h.methods.has('collaboration.messages')).toBe(true);
    expect(h.factories.size).toBe(0);
    expect(h.providers).toEqual([]);
    expect(h.hooks.has('agent_turn_prepare')).toBe(false);
  });
  it.each([true, false])('resolves receipt history with agent-team enabled=%s', async enabled => {
    const h = fixture(enabled);
    h.setTranscriptEntries([{ idempotencyKey: 'receipt:user', message: {
      role: 'user', content: 'Review complete', idempotencyKey: 'receipt:user',
      provenance: { kind: 'inter_session', sourceTool: 'sessions_send', sourceSessionKey: 'agent:a:justdo:a' },
    } }, { idempotencyKey: 'other:user', message: {
      role: 'user', content: 'Hidden', idempotencyKey: 'other:user',
      provenance: { kind: 'inter_session', sourceTool: 'sessions_send', sourceSessionKey: 'agent:a:justdo:a' },
    } }]);
    const response = vi.fn();
    await h.methods.get('collaboration.messages')!({ params: { lookups: [{
      deliveryId: 'delivery', receiptId: 'receipt', sessionId: 'b',
      sessionKey: 'agent:b:justdo:b', sourceSessionKey: 'agent:a:justdo:a',
    }] }, respond: response });
    expect(response).toHaveBeenCalledWith(true, { messages: [{
      deliveryId: 'delivery', message: expect.objectContaining({ content: 'Review complete' }),
    }] });
    h.stop();
  });
  it.each(['missing native session', 'different sender'])(
    'does not return a receipt body for %s', async reason => {
      const h = fixture();
      if (reason === 'missing native session') h.setNativeSessionId('');
      h.setTranscriptEntries([{ idempotencyKey: 'receipt:user', message: {
        role: 'user', content: 'Private message', idempotencyKey: 'receipt:user',
        provenance: { kind: 'inter_session', sourceTool: 'sessions_send', sourceSessionKey: 'agent:c:justdo:c' },
      } }]);
      const response = vi.fn();
      await h.methods.get('collaboration.messages')!({ params: { lookups: [{
        deliveryId: 'delivery', receiptId: 'receipt', sessionId: 'b',
        sessionKey: 'agent:b:justdo:b', sourceSessionKey: 'agent:a:justdo:a',
      }] }, respond: response });
      expect(response).toHaveBeenCalledWith(true, { messages: [{ deliveryId: 'delivery' }] });
      h.stop();
    },
  );
  it('grants only the admitted native send and revokes access after its receipt', async () => {
    const h = fixture();
    const ctx = { sessionKey: 'agent:main:justdo:a', runId: 'run', toolCallId: 'send' };
    const target = 'agent:review:justdo:b';
    const result = await h.hooks.get('before_tool_call')!({ toolName: 'sessions_send', params: { sessionKey: target, message: 'Review', timeoutSeconds: 30, watch: true } }, ctx);
    expect(result).toEqual({ params: { sessionKey: target, message: 'Review', timeoutSeconds: 0, watch: false } });
    const access = { action: 'send', requesterSessionKey: ctx.sessionKey, targetSessionKey: target };
    expect(h.providers[0](access)).toEqual({ expectedSessionId: 'native-target' });
    expect(h.providers[0]({ ...access, action: 'history' })).toBeUndefined();
    expect(h.providers[0]({ ...access, targetSessionKey: 'agent:review:justdo:foreign' })).toBeUndefined();
    expect(h.providers[0]({ ...access, requesterSessionKey: 'agent:main:justdo:foreign' })).toBeUndefined();
    await h.hooks.get('after_tool_call')!({ toolName: 'sessions_send', result: { details: { status: 'accepted', runId: 'peer-run' } } }, ctx);
    expect(h.providers[0](access)).toBeUndefined();
    expect(h.emit.mock.calls.at(-1)![1]).toMatchObject({ operation: 'native-result', input: { deliveryId: 'receipt', status: 'accepted', runId: 'peer-run' } });
    expect(h.factories.has('sessions_send')).toBe(false);
    expect(h.factories.has('collaboration_send')).toBe(false);
    h.stop();
  });
  it('declares every model tool in the packaged plugin manifest', () => {
    const h = fixture();
    const manifest = JSON.parse(readFileSync('openclaw-extensions/agent-team/openclaw.plugin.json', 'utf8'));
    expect([...h.factories.keys()].sort()).toEqual([...manifest.contracts.tools].sort());
    h.stop();
  });
  it('pins a scoped send to the target incarnation before asynchronous host admission', async () => {
    const h = fixture();
    const ctx = { sessionKey: 'agent:main:justdo:a', runId: 'run', toolCallId: 'send' };
    const target = 'agent:review:justdo:b';
    const resolveHost = h.emit.getMockImplementation()!;
    h.emit.mockImplementation((event, payload) => {
      h.setNativeSessionId('replacement-target');
      return resolveHost(event, payload);
    });
    await h.hooks.get('before_tool_call')!({
      toolName: 'sessions_send', params: { sessionKey: target, message: 'Review' },
    }, ctx);
    expect(h.providers[0]({
      action: 'send', requesterSessionKey: ctx.sessionKey, targetSessionKey: target,
    })).toEqual({ expectedSessionId: 'native-target' });
    h.stop();
  });
  it('keeps collaboration tools callable through the compact tool catalog', () => {
    const h = fixture();
    expect(h.toolOptions.get('task_assistants')).not.toHaveProperty('catalogMode');
    expect(h.toolOptions.get('assistants_create')).not.toHaveProperty('catalogMode');
    h.stop();
  });
  it('takes source run and session from the native hook rather than model fields', async () => {
    const h = fixture();
    const sessionKey = 'agent:research:justdo:session';
    await h.hooks.get('before_tool_call')!({ toolName: 'task_assistants', params: { agentId: 'review' } }, { sessionKey, runId: 'native-run', toolCallId: 'call' });
    const tool = h.factories.get('task_assistants')!({ sessionKey });
    const result = await tool.execute('call', { agentId: 'review', message: 'review this' });
    expect(result.isError).toBe(false);
    expect(h.emit.mock.calls[0][1]).toMatchObject({ sessionKey, sourceRunId: 'native-run', toolCallId: 'call' });
    await expect(tool.execute('call', { agentId: 'review', message: 'replay' })).rejects.toThrow('no longer active');
    h.stop();
  });
  it('attaches a host deadline independently of model input', async () => {
    const h = fixture();
    const sessionKey = 'agent:a:justdo:a';
    await h.hooks.get('before_tool_call')!({ toolName: 'task_assistants', params: { agentId: 'review' } }, {
      sessionKey, runId: 'run', toolCallId: 'deadline-call',
    });
    const before = Date.now();
    await h.factories.get('task_assistants')!({ sessionKey }).execute('deadline-call', {
      agentId: 'b', expiresAt: Number.MAX_SAFE_INTEGER,
    });
    const payload = h.emit.mock.calls[0][1];
    expect(payload.expiresAt).toBeGreaterThanOrEqual(before + 8000);
    expect(payload.expiresAt).toBeLessThanOrEqual(Date.now() + 8000);
    h.stop();
  });
  it('rejects timed-out host requests and ignores their late receipts', async () => {
    vi.useFakeTimers();
    const h = fixture();
    try {
      h.emit.mockImplementation(() => undefined);
      const tool = h.factories.get('task_assistants')!({ sessionKey: 'agent:a:justdo:a' });
      const assertion = expect(tool.execute('lookup', {})).rejects.toThrow('did not respond');
      await vi.advanceTimersByTimeAsync(8000);
      await assertion;
      const respond = vi.fn();
      h.methods.get('collaboration.resolve')!({
        params: { requestId: h.emit.mock.calls[0][1].requestId, result: { state: 'queued' } }, respond,
      });
      expect(respond).toHaveBeenCalledWith(true, { stale: true });
    } finally {
      h.stop();
      vi.useRealTimers();
    }
  });
  it('binds assistant creation to the native call and blocks it in Plan mode', async () => {
    const h = fixture();
    const sessionKey = 'agent:a:justdo:a';
    const tool = h.factories.get('assistants_create')!({ sessionKey });
    await expect(tool.execute('unbound', { name: 'Review' })).rejects.toThrow('no longer active');
    await h.hooks.get('before_tool_call')!({ toolName: 'assistants_create' }, {
      sessionKey, runId: 'run', toolCallId: 'create',
    });
    await tool.execute('create', { name: 'Review', description: '', instructions: 'Review work' });
    expect(h.emit.mock.calls[0][1]).toMatchObject({ operation: 'create', sourceRunId: 'run' });
    expect(h.emit.mock.calls[0][1].expiresAt).toBeGreaterThan(Date.now() + 59000);
    h.setPlan();
    await h.hooks.get('before_tool_call')!({ toolName: 'assistants_create' }, {
      sessionKey, runId: 'run', toolCallId: 'blocked',
    });
    await expect(tool.execute('blocked', {})).rejects.toThrow('Plan mode');
    h.stop();
  });
  it('blocks sends in Plan mode and omits tools for subagent keys', async () => {
    const h = fixture(); h.setPlan();
    const sessionKey = 'agent:a:justdo:a';
    await h.hooks.get('before_tool_call')!({ toolName: 'task_assistants', params: { agentId: 'review' } }, {
      sessionKey, runId: 'run', toolCallId: 'call',
    });
    await expect(h.factories.get('task_assistants')!({ sessionKey }).execute('call', { agentId: 'b', message: 'blocked' })).rejects.toThrow('Plan mode');
    expect(h.factories.get('task_assistants')!({ sessionKey: 'agent:a:subagent:child' })).toBeNull();
    h.stop();
  });
});
