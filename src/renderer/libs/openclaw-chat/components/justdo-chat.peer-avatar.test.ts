/** @vitest-environment jsdom */
import './justdo-chat';

import { afterEach, expect, test } from 'vitest';

import { ChatController } from '../gateway/chat-controller';
import type { JustDoChatElement } from './justdo-chat';

afterEach(() => document.body.replaceChildren());

test.each([false, true])(
  'keeps one matching assistant avatar per reply group (process first: %s)',
  async processFirst => {
    const chat = document.createElement('justdo-chat') as JustDoChatElement;
    chat.peerPerspective = true;
    chat.assistantName = '实现助手';
    chat.assistantId = 'implement';
    chat.peerColors = { implement: '#d97706', review: '#0d9488' };
    chat.peerNames = { review: '审查助手' };
    const incoming = (id: string) => ({
      id,
      role: 'assistant',
      content: 'Please review this change',
      provenance: {
        kind: 'inter_session',
        sourceTool: 'sessions_send',
        sourceSessionKey: 'agent:review:justdo:review-session',
      },
    });
    const controller = new ChatController();
    controller.state.visibleChatMessages = [
      incoming('in-1'),
      ...(processFirst
        ? [
            {
              id: 'thinking-1',
              role: 'assistant',
              content: [{ type: 'thinking', thinking: 'Planning the change' }],
            },
          ]
        : []),
      { id: 'out-1', role: 'assistant', content: 'First reply' },
      { id: 'out-2', role: 'assistant', content: 'Second reply' },
      incoming('in-2'),
      { id: 'out-3', role: 'assistant', content: 'Next reply' },
    ];
    chat.controller = controller;
    document.body.append(chat);
    await chat.updateComplete;
    const groups = [
      ...chat.shadowRoot!.querySelectorAll('.chat-group--assistant.chat-group--content'),
    ];
    expect(groups).toHaveLength(3);
    expect(groups.map(group => !!group.querySelector('.chat-avatar'))).toEqual(
      processFirst ? [false, false, true] : [true, false, true],
    );
    const avatars = [...chat.shadowRoot!.querySelectorAll('.chat-group--assistant .chat-avatar')];
    expect(avatars).toHaveLength(2);
    for (const avatar of avatars) {
      expect(avatar.getAttribute('title')).toBe('实现助手');
      expect(avatar.textContent?.trim()).toBe('实');
      expect(avatar.getAttribute('style')).toContain('#d97706');
      expect(avatar.querySelector('svg')).toBeNull();
    }
    expect(chat.shadowRoot!.querySelectorAll('.chat-group--user .chat-avatar')).toHaveLength(2);
  },
);
