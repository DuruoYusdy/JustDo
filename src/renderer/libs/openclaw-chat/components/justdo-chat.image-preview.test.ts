/** @vitest-environment jsdom */

import './justdo-chat';

import { afterEach, describe, expect, test, vi } from 'vitest';

import type { JustDoChatElement } from './justdo-chat';

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, 'electron');
});

describe('justdo-chat image preview', () => {
  test.each(['chat-bubble__image', 'markdown-inline-image'])(
    'opens a sidebar tab when a %s is clicked',
    async className => {
      const open = vi.fn().mockResolvedValue({ success: true });
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { imagePreview: { open } },
      });
      const chat = document.createElement('justdo-chat') as JustDoChatElement;
      document.body.append(chat);
      await chat.updateComplete;
      const onPreview = vi.fn();
      window.addEventListener('cowork:preview-image', onPreview);

      const thumbnail = document.createElement('img');
      thumbnail.className = className;
      thumbnail.src = 'data:image/png;base64,AA==';
      thumbnail.alt = 'detail';
      chat.shadowRoot?.append(thumbnail);

      thumbnail.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
      );
      await Promise.resolve();

      expect(onPreview).toHaveBeenCalledTimes(1);
      expect((onPreview.mock.calls[0][0] as CustomEvent).detail).toEqual({
        src: 'data:image/png;base64,AA==',
        alt: 'detail',
      });
      expect(open).not.toHaveBeenCalled();
      window.removeEventListener('cowork:preview-image', onPreview);
      expect(chat.shadowRoot?.querySelector('.image-preview')).toBeNull();
    },
  );
});
