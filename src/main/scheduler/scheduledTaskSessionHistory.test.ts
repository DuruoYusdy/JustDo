import { expect, test, vi } from 'vitest';

import { readScheduledTaskSessionHistory } from './scheduledTaskSessionHistory';

test('assembles bounded chunks for the exact physical run without looking up a current session', async () => {
  const messages = [{ role: 'assistant', content: 'Historical result' }];
  const serialized = JSON.stringify(messages);
  const request = vi
    .fn()
    .mockResolvedValueOnce({ version: 'v1', chunk: serialized.slice(0, 10), nextOffset: 10 })
    .mockResolvedValueOnce({ version: 'v1', chunk: serialized.slice(10), nextOffset: null });
  await expect(readScheduledTaskSessionHistory(request, 'run-key', 'old-id')).resolves.toEqual({
    sessionKey: 'run-key',
    messages,
  });
  expect(request).toHaveBeenLastCalledWith({
    sessionKey: 'run-key',
    sessionId: 'old-id',
    offset: 10,
    version: 'v1',
  });
});

test.each(['not-found', 'empty'] as const)('preserves definitive %s results', async reason => {
  await expect(
    readScheduledTaskSessionHistory(
      vi.fn().mockResolvedValue({ unavailableReason: reason }),
      'key',
      'id',
    ),
  ).resolves.toEqual({ sessionKey: 'key', messages: [], unavailableReason: reason });
});

test('rejects changed transcript chunks rather than mixing runs or generations', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ version: 'v1', chunk: '[', nextOffset: 1 })
    .mockResolvedValueOnce({ version: 'v2', chunk: ']', nextOffset: null });
  await expect(readScheduledTaskSessionHistory(request, 'key', 'id')).rejects.toThrow(
    'Invalid scheduled task history response',
  );
});
