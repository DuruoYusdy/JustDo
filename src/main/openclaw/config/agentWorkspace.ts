import path from 'path';

import { normalizeOpenClawAgentId } from '../../../shared/openclaw/agentId';

// Keep the established main workspace; independent roles have stable homes.
export function resolveManagedAgentWorkspace(
  stateDir: string,
  projectDir: string,
  agentId: string,
): string {
  const id = normalizeOpenClawAgentId(agentId);
  return id === 'main'
    ? projectDir
    : path.join(stateDir, 'agent-workspaces', id);
}
