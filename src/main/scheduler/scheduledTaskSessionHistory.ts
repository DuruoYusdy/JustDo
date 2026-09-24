import type { ScheduledTaskSessionHistory } from '../../shared/scheduledTask/types';

interface HistoryChunk {
  unavailableReason?: 'not-found' | 'empty';
  version?: string;
  chunk?: string;
  nextOffset?: number | null;
}

export async function readScheduledTaskSessionHistory(
  request: (params: Record<string, unknown>) => Promise<HistoryChunk>,
  sessionKey: string,
  sessionId: string,
): Promise<ScheduledTaskSessionHistory> {
  let serialized = '';
  let version: string | undefined;
  for (;;) {
    const page = await request({
      sessionKey,
      sessionId,
      offset: serialized.length,
      ...(version ? { version } : {}),
    });
    if (page.unavailableReason) {
      if (serialized) throw new Error('Scheduled task history changed during lookup');
      return { sessionKey, messages: [], unavailableReason: page.unavailableReason };
    }
    if (
      typeof page.chunk !== 'string' ||
      !page.chunk ||
      !page.version ||
      (version && version !== page.version)
    ) {
      throw new Error('Invalid scheduled task history response');
    }
    version = page.version;
    serialized += page.chunk;
    if (page.nextOffset === null) break;
    if (page.nextOffset !== serialized.length)
      throw new Error('Invalid scheduled task history offset');
  }
  const messages: unknown = JSON.parse(serialized);
  if (!Array.isArray(messages)) throw new Error('Invalid scheduled task history messages');
  return { sessionKey, messages };
}
