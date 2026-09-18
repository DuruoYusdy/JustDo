import { describe, expect, it } from 'vitest';

import {
  isCurrentThreadRunning,
  mergePendingUserMessage,
  messagesFromThread,
  shouldShowTurnError,
  toolDisplayTitle,
  toolInputSummary,
} from '../../resources/browser-extension/conversation-overlay/modules/sidepanel-state.js';

describe('browser extension side panel state', () => {
  it('does not treat two empty thread ids as a running turn', () => {
    expect(isCurrentThreadRunning('', '')).toBe(false);
  });

  it('only reports a running turn for the selected real thread', () => {
    expect(isCurrentThreadRunning('thread-1', 'thread-1')).toBe(true);
    expect(isCurrentThreadRunning('thread-1', 'thread-2')).toBe(false);
  });

  it('does not show a completed turn error after switching threads', () => {
    expect(shouldShowTurnError('thread-1', 'thread-1', true)).toBe(true);
    expect(shouldShowTurnError('thread-1', 'thread-2', true)).toBe(false);
    expect(shouldShowTurnError('thread-1', 'thread-1', false)).toBe(false);
  });

  it('shows a submitted user message until it appears in persisted history', () => {
    const pending = { threadId: 'thread-1', text: 'Hello' };
    expect(mergePendingUserMessage([], pending, 'thread-1')).toEqual([
      { role: 'user', text: 'Hello' },
    ]);
    expect(mergePendingUserMessage([{ role: 'user', text: 'Hello' }], pending, 'thread-1')).toEqual(
      [{ role: 'user', text: 'Hello' }],
    );
    expect(mergePendingUserMessage([], pending, 'thread-2')).toEqual([]);
  });

  it('keeps a repeated user message optimistic until a new matching row is persisted', () => {
    const pending = { threadId: 'thread-1', text: 'Again', persistedMatches: 1 };
    const previous = [{ role: 'user', text: 'Again' }];
    expect(mergePendingUserMessage(previous, pending, 'thread-1')).toEqual([
      ...previous,
      { role: 'user', text: 'Again' },
    ]);
    expect(
      mergePendingUserMessage([...previous, { role: 'user', text: 'Again' }], pending, 'thread-1'),
    ).toEqual([...previous, { role: 'user', text: 'Again' }]);
  });

  it('formats a compact desktop-style tool input summary', () => {
    expect(toolInputSummary({ path: 'notes.txt', line: 12 })).toBe(
      '{ "path": "notes.txt", "line": 12 }',
    );
    expect(toolInputSummary('x'.repeat(200))).toBe(`${'x'.repeat(159)}…`);
  });

  it('uses the desktop tool display titles', () => {
    expect(toolDisplayTitle('read')).toBe('Read');
    expect(toolDisplayTitle('sessions_yield')).toBe('Yield');
    expect(toolDisplayTitle('custom_tool')).toBe('Custom Tool');
  });

  it('projects reasoning and completed tool calls for side panel rendering', () => {
    expect(
      messagesFromThread({
        turns: [
          {
            items: [
              { type: 'reasoning', summary: [], content: ['Check the file.'] },
              {
                type: 'toolCall',
                toolName: 'read',
                input: { path: 'notes.txt' },
                output: 'hello',
                status: 'completed',
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        role: 'process',
        key: 'turn-process-0',
        title: 'Thinking × 1 · Tool × 1',
        items: [
          { id: undefined, type: 'thinking', text: 'Check the file.', title: 'Thinking' },
          {
            id: undefined,
            type: 'tool',
            title: 'Read',
            input: '{\n  "path": "notes.txt"\n}',
            output: 'hello',
            isError: false,
            status: 'completed',
          },
        ],
      },
    ]);
  });

  it('groups only consecutive process items and keeps message order', () => {
    const entries = messagesFromThread({
      turns: [
        {
          items: [
            { type: 'reasoning', content: ['First thought.'] },
            { type: 'reasoning', content: ['Second thought.'] },
            { type: 'agentMessage', text: 'Interim answer' },
            { type: 'toolCall', toolName: 'read', status: 'inProgress' },
          ],
        },
      ],
    });

    expect(entries.map(entry => ({ role: entry.role, title: entry.title }))).toEqual([
      { role: 'process', title: 'Thinking × 2' },
      { role: 'assistant', title: undefined },
      { role: 'process', title: 'Tool × 1' },
    ]);
  });

  it('keeps a stable process key while new activity is appended', () => {
    const createThread = (items: Array<Record<string, unknown>>) => ({
      turns: [{ id: 'turn-1', items }],
    });
    const first = messagesFromThread(
      createThread([{ id: 'thinking-1', type: 'reasoning', content: ['First thought.'] }]),
    );
    const updated = messagesFromThread(
      createThread([
        { id: 'thinking-1', type: 'reasoning', content: ['First thought.'] },
        { id: 'tool-1', type: 'toolCall', toolName: 'read', status: 'inProgress' },
      ]),
    );

    expect(first[0].key).toBe('thinking-1');
    expect(updated[0].key).toBe('thinking-1');
  });
});
