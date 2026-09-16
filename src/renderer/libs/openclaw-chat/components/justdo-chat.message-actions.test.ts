/** @vitest-environment jsdom */

import './justdo-chat';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { ChatController } from '@/libs/openclaw-chat/gateway/chat-controller';

import type { JustDoChatElement } from './justdo-chat';

function notifyController(controller: ChatController): void {
  (controller as unknown as { notify(): void }).notify();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('justdo-chat last user message actions', () => {
  test('only exposes actions for the latest persisted user message while idle', async () => {
    const controller = new ChatController();
    const messages = [
      {
        role: 'user',
        content: 'first prompt',
        timestamp: 1,
        __openclaw: { id: 'user-1', seq: 1 },
      },
      {
        role: 'assistant',
        content: 'first reply',
        timestamp: 2,
        __openclaw: { id: 'assistant-1', seq: 2 },
      },
      {
        role: 'user',
        content: 'latest prompt',
        timestamp: 3,
        __openclaw: { id: 'user-2', seq: 3 },
      },
      {
        role: 'assistant',
        content: 'latest reply',
        timestamp: 4,
        __openclaw: { id: 'assistant-2', seq: 4 },
      },
    ];
    controller.state.sessionKey = 'agent:main:justdo:session-1';
    controller.state.connected = true;
    (
      controller as unknown as {
        setCurrentSessionMessages(
          messages: unknown[],
          options: { resetLoadedHistory: boolean },
        ): void;
      }
    ).setCurrentSessionMessages(messages, { resetLoadedHistory: true });
    const onAction = vi.fn().mockResolvedValue(true);
    const chat = document.createElement('justdo-chat') as JustDoChatElement;
    chat.controller = controller;
    chat.onLastUserMessageAction = onAction;
    document.body.append(chat);
    await chat.updateComplete;

    const buttons = chat.shadowRoot?.querySelectorAll<HTMLButtonElement>('.user-message-action');
    const actions = chat.shadowRoot?.querySelector<HTMLElement>('.user-message-actions');
    expect(buttons).toHaveLength(2);
    expect(actions).not.toBeNull();
    expect(getComputedStyle(actions as HTMLElement).pointerEvents).toBe('auto');
    buttons?.[0]?.click();
    await chat.updateComplete;
    expect(onAction).not.toHaveBeenCalled();
    const editor = chat.shadowRoot?.querySelector<HTMLTextAreaElement>(
      '.user-message-editor__input',
    );
    expect(editor?.value).toBe('latest prompt');

    editor!.value = 'corrected prompt';
    editor!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    chat.shadowRoot?.querySelector<HTMLButtonElement>('.user-message-editor__submit')?.click();
    await vi.waitFor(() => {
      expect(onAction).toHaveBeenCalledWith('edit', 'user-2', 'corrected prompt');
    });
    await chat.updateComplete;
    expect(chat.shadowRoot?.querySelector('.user-message-editor')).toBeNull();

    controller.state.chatSending = true;
    notifyController(controller);
    await chat.updateComplete;
    expect(chat.shadowRoot?.querySelectorAll('.user-message-action')).toHaveLength(0);
  });

  test('cancels inline editing without mutating message history', async () => {
    const controller = new ChatController();
    controller.state.sessionKey = 'agent:main:justdo:session-1';
    controller.state.connected = true;
    (
      controller as unknown as {
        setCurrentSessionMessages(
          messages: unknown[],
          options: { resetLoadedHistory: boolean },
        ): void;
      }
    ).setCurrentSessionMessages(
      [{ role: 'user', content: 'original', __openclaw: { id: 'user-1' } }],
      { resetLoadedHistory: true },
    );
    const onAction = vi.fn().mockResolvedValue(true);
    const chat = document.createElement('justdo-chat') as JustDoChatElement;
    chat.controller = controller;
    chat.onLastUserMessageAction = onAction;
    document.body.append(chat);
    await chat.updateComplete;

    chat.shadowRoot?.querySelector<HTMLButtonElement>('.user-message-action')?.click();
    await chat.updateComplete;
    chat.shadowRoot
      ?.querySelector<HTMLButtonElement>('.user-message-editor__actions button')
      ?.click();
    await chat.updateComplete;

    expect(onAction).not.toHaveBeenCalled();
    expect(chat.shadowRoot?.querySelector('.user-message-editor')).toBeNull();
    expect(chat.shadowRoot?.textContent).toContain('original');
  });

  test('does not expose actions while disconnected or when the latest user entry is pending', async () => {
    const controller = new ChatController();
    controller.state.sessionKey = 'agent:main:justdo:session-1';
    const setMessages = (messages: unknown[]) =>
      (
        controller as unknown as {
          setCurrentSessionMessages(
            messages: unknown[],
            options: { resetLoadedHistory: boolean },
          ): void;
        }
      ).setCurrentSessionMessages(messages, { resetLoadedHistory: true });
    setMessages([{ role: 'user', content: 'persisted', __openclaw: { id: 'persisted-user' } }]);
    const chat = document.createElement('justdo-chat') as JustDoChatElement;
    chat.controller = controller;
    chat.onLastUserMessageAction = vi.fn();
    document.body.append(chat);
    await chat.updateComplete;
    expect(chat.shadowRoot?.querySelectorAll('.user-message-action')).toHaveLength(0);

    controller.state.connected = true;
    setMessages([
      { role: 'user', content: 'persisted', __openclaw: { id: 'persisted-user' } },
      { role: 'user', content: 'pending', __openclaw: { kind: 'pending-send' } },
    ]);
    notifyController(controller);
    await chat.updateComplete;
    expect(chat.shadowRoot?.querySelectorAll('.user-message-action')).toHaveLength(0);
  });
});
