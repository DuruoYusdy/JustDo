import path from 'path';

import { normalizeOpenClawAgentId } from '../../../shared/openclaw/agentId';
import { ScheduledTaskAgentId } from '../../../shared/scheduledTask/constants';

// Keep the established main/scheduler workspace; independent roles have stable homes.
export function resolveManagedAgentWorkspace(
  stateDir: string,
  projectDir: string,
  agentId: string,
): string {
  const id = normalizeOpenClawAgentId(agentId);
  return id === 'main' || id === ScheduledTaskAgentId
    ? projectDir
    : path.join(stateDir, 'agent-workspaces', id);
}
