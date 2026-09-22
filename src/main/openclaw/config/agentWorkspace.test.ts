import path from 'path';
import { describe, expect, it } from 'vitest';

import { resolveManagedAgentWorkspace } from './agentWorkspace';
describe('independent agent workspace ownership', () => {
  it('keeps roles separate while the selected project changes', () => {
    const state = path.resolve('用户目录 with spaces');
    const first = resolveManagedAgentWorkspace(state, '/project-a', 'research');
    expect(first).toBe(resolveManagedAgentWorkspace(state, '/project-b', 'research'));
    expect(first).not.toBe(resolveManagedAgentWorkspace(state, '/project-a', 'review'));
    expect(first).toBe(path.join(state, 'agent-workspaces', 'research'));
  });
  it('retains existing main rules without moving user files', () => {
    expect(resolveManagedAgentWorkspace('/state', '/existing-main', 'main')).toBe('/existing-main');
  });
  it('canonicalizes role IDs before constructing paths', () => {
    expect(resolveManagedAgentWorkspace('/state', '/project', '../REVIEW')).toBe(
      path.join('/state', 'agent-workspaces', 'review'),
    );
  });
});
