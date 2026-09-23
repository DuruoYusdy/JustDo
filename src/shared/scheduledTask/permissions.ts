import type { EditableScheduledTaskPayload } from './types';

export const ScheduledTaskPermission = {
  ReadOnly: 'read-only',
  Full: 'full',
  Custom: 'custom',
} as const;

export type ScheduledTaskPermission =
  (typeof ScheduledTaskPermission)[keyof typeof ScheduledTaskPermission];

// Native cron tool allowlists apply to each run, including manual runs. Do not
// allow exec, child agents, browser automation, or arbitrary MCP tools here.
export const SCHEDULED_TASK_READ_ONLY_TOOLS = [
  'read',
  'web_search',
  'web_fetch',
  'memory_search',
  'memory_get',
] as const;

export function getScheduledTaskPermission(payload: {
  toolsAllow?: string[];
  permissionMode?: 'read-only' | 'full';
}): ScheduledTaskPermission {
  if (payload.permissionMode === 'full' && payload.toolsAllow?.includes('*'))
    return ScheduledTaskPermission.Full;
  const tools = new Set(payload.toolsAllow ?? []);
  return tools.size === SCHEDULED_TASK_READ_ONLY_TOOLS.length &&
    SCHEDULED_TASK_READ_ONLY_TOOLS.every(tool => tools.has(tool))
    ? ScheduledTaskPermission.ReadOnly
    : ScheduledTaskPermission.Custom;
}

export function applyScheduledTaskPermission(
  payload: EditableScheduledTaskPayload,
  mode: ScheduledTaskPermission,
): EditableScheduledTaskPayload {
  if (payload.kind !== 'agentTurn') {
    throw new Error('Permission presets require an agent-turn task payload');
  }
  if (mode === ScheduledTaskPermission.Custom) return payload;
  if (mode !== ScheduledTaskPermission.ReadOnly && mode !== ScheduledTaskPermission.Full) {
    throw new Error('Invalid scheduled task permission mode');
  }
  return {
    ...payload,
    permissionMode: mode,
    toolsAllow:
      mode === ScheduledTaskPermission.ReadOnly ? [...SCHEDULED_TASK_READ_ONLY_TOOLS] : ['*'],
  };
}
