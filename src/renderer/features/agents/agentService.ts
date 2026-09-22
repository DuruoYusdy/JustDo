import { setAgents, setLoading } from '@/features/agents/agentSlice';
import { store } from '@/store';

class AgentService {
  private loadRevision = 0;
  async loadAgents(): Promise<void> {
    const revision = ++this.loadRevision;
    store.dispatch(setLoading(true));
    try {
      const agents = await window.electron?.agents?.list();
      if (agents && revision === this.loadRevision) {
        const mappedAgents = agents.map(a => ({
          id: a.id,
          name: a.name,
          description: a.description,
          icon: a.icon,
          model: a.model ?? '',
          enabled: a.enabled,
          deletedAt: a.deletedAt,
          isDefault: a.isDefault,
          skillIds: a.skillIds ?? [],
        }));
        store.dispatch(setAgents(mappedAgents));
      }
    } catch (error) {
      console.error('Failed to load agents:', error);
    } finally {
      if (revision === this.loadRevision) store.dispatch(setLoading(false));
    }
  }
}

export const agentService = new AgentService();
