import { describe, expect, it } from 'vitest';

import reducer, { setAgents, setCurrentAgentId } from './agentSlice';
const agent = (id: string, enabled = true, isDefault = false) => ({
  id,
  name: id,
  description: '',
  icon: '',
  model: '',
  skillIds: [],
  enabled,
  isDefault,
});
describe('new conversation agent selection', () => {
  it('keeps user conversations on main regardless of saved defaults or role selection', () => {
    let state = reducer(
      undefined,
      setAgents([agent('main'), agent('research', true, true), agent('disabled', false)]),
    );
    expect(state.currentAgentId).toBe('main');
    state = reducer(state, setCurrentAgentId('research'));
    expect(state.currentAgentId).toBe('main');
    state = reducer(state, setCurrentAgentId('disabled'));
    expect(state.currentAgentId).toBe('main');
    state = reducer(state, setCurrentAgentId('main'));
    expect(state.currentAgentId).toBe('main');
  });
  it('falls back to the default when the selected role is disabled', () => {
    const state = reducer(undefined, setAgents([agent('main'), agent('research', true, true)]));
    const next = reducer(state, setAgents([agent('main', true, true), agent('research', false)]));
    expect(next.currentAgentId).toBe('main');
  });
});
