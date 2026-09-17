/**
 * ACPX runtime plugin entry. It registers the embedded ACP backend service and
 * wires reply-dispatch hooks into the plugin SDK runtime.
 */
import { tryDispatchAcpReplyHook } from 'openclaw/plugin-sdk/acp-runtime-backend';
import { finiteSecondsToTimerSafeMilliseconds } from 'openclaw/plugin-sdk/number-runtime';
import { redactSensitiveText } from 'openclaw/plugin-sdk/security-runtime';
import { createAcpxRuntimeService } from './register.runtime.js';
import { getAcpRuntimeBackend } from './runtime-api.js';
import type {
  OpenClawPluginApi,
  PluginHookReplyDispatchContext,
  PluginHookReplyDispatchEvent,
  PluginHookReplyDispatchResult,
} from './runtime-api.js';
import { DEFAULT_ACPX_TIMEOUT_SECONDS } from './src/config-schema.js';
import { registerPiSessionCatalog } from './src/pi-session-catalog-plugin.js';

function resolveReplyDispatchTimeoutMs(pluginConfig?: Record<string, unknown>): number {
  const timeoutSeconds = pluginConfig?.timeoutSeconds;
  const resolvedSeconds =
    typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds
      : DEFAULT_ACPX_TIMEOUT_SECONDS;
  return finiteSecondsToTimerSafeMilliseconds(resolvedSeconds) ?? 1;
}

function resolveDoctorAgentIds(pluginConfig?: Record<string, unknown>): ReadonlySet<string> {
  const configuredAgents = Array.isArray(pluginConfig?.diagnosticAgents)
    ? pluginConfig.diagnosticAgents
    : [];
  return new Set(
    configuredAgents.filter(
      (agentId): agentId is string =>
        typeof agentId === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(agentId),
    ),
  );
}

async function tryDispatchAcpReplyHookWithTimeout(
  event: PluginHookReplyDispatchEvent,
  ctx: PluginHookReplyDispatchContext,
  timeoutMs: number,
): Promise<PluginHookReplyDispatchResult | void> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  timeout.unref?.();
  const abortSignal = ctx.abortSignal
    ? AbortSignal.any([ctx.abortSignal, timeoutController.signal])
    : timeoutController.signal;
  try {
    return await tryDispatchAcpReplyHook(event, {
      ...ctx,
      abortSignal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

const plugin = {
  id: 'acpx',
  name: 'ACPX Runtime',
  description: 'Embedded ACP runtime backend with plugin-owned session and transport management.',
  register(api: OpenClawPluginApi) {
    const replyDispatchTimeoutMs = resolveReplyDispatchTimeoutMs(api.pluginConfig);
    const doctorAgentIds = resolveDoctorAgentIds(api.pluginConfig);
    registerPiSessionCatalog(api);
    api.registerService(
      createAcpxRuntimeService({
        pluginConfig: api.pluginConfig,
        openKeyedStore: options => api.runtime.state.openKeyedStore(options),
      }),
    );
    api.registerGatewayMethod(
      'acpx.agent.doctor',
      async ({ params, respond }) => {
        const agentId = typeof params.agentId === 'string' ? params.agentId.trim() : '';
        if (!doctorAgentIds.has(agentId)) {
          respond(false, undefined, {
            code: 'INVALID_REQUEST',
            message: 'The ACP agent is not available for diagnostics.',
          });
          return;
        }
        const runtime = getAcpRuntimeBackend('acpx')?.runtime;
        if (!runtime || !('doctorAgent' in runtime)) {
          respond(false, undefined, {
            code: 'UNAVAILABLE',
            message: 'ACPX runtime is not available.',
          });
          return;
        }
        try {
          const report = await (
            runtime as { doctorAgent: (id: string) => Promise<unknown> }
          ).doctorAgent(agentId);
          respond(true, report);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'ACP agent test failed.';
          respond(false, undefined, {
            code: 'UNAVAILABLE',
            message: redactSensitiveText(message).slice(0, 2_000),
          });
        }
      },
      { scope: 'operator.read' },
    );
    api.on(
      'reply_dispatch',
      (event, ctx) => tryDispatchAcpReplyHookWithTimeout(event, ctx, replyDispatchTimeoutMs),
      { timeoutMs: replyDispatchTimeoutMs, eligibleDispatchKinds: ['acp'] },
    );
  },
};

export default plugin;
