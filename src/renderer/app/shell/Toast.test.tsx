// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import Toast from './Toast';

describe('Toast', () => {
  afterEach(cleanup);

  test('vertically centers a compact notification without a title', () => {
    const { container } = render(<Toast message="Session ID copied" onClose={() => undefined} />);

    expect(screen.getByRole('status')).toBeTruthy();
    expect(container.querySelector('.items-center')).toBeTruthy();
    expect(container.querySelector('.items-start')).toBeNull();
  });

  test('renders a non-modal warning notification with a title', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Toast
        title="Command unavailable"
        message="The /update command is managed by the app and cannot be run from chat."
        tone="warning"
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Command unavailable')).toBeTruthy();
    expect(container.querySelector('.modal-backdrop')).toBeNull();

    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
