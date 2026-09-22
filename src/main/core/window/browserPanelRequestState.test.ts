import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserHttpAuthRequests, BrowserPermissionState } from './browserPanelRequestState';

describe('browser permission lifecycle', () => {
  it('requires separate audio and video grants in the requesting origin', () => {
    const state = new BrowserPermissionState();
    state.grant(1, 'https://frame.test', 'media', ['audio']);
    expect(state.has(1, 'https://frame.test', 'media', ['audio'])).toBe(true);
    expect(state.has(1, 'https://frame.test', 'media', ['video'])).toBe(false);
    expect(state.has(1, 'https://frame.test', 'media', ['audio', 'video'])).toBe(false);
    expect(state.has(1, 'https://top.test', 'media', ['audio'])).toBe(false);
    state.grant(1, 'https://frame.test', 'media', ['video']);
    expect(state.has(1, 'https://frame.test', 'media', ['audio', 'video'])).toBe(true);
  });

  it('invalidates queued prompts and old grants on same-origin or child-frame navigation', () => {
    const state = new BrowserPermissionState();
    const isCurrent = state.capture(1);
    state.grant(1, 'https://frame.test', 'media', ['audio']);
    expect(isCurrent()).toBe(true);
    state.invalidate(1);
    expect(isCurrent()).toBe(false);
    expect(state.has(1, 'https://frame.test', 'media', ['audio'])).toBe(false);
    const next = state.capture(1);
    expect(next()).toBe(true);
    state.destroy(1);
    expect(next()).toBe(false);
  });
});

describe('browser authentication lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('dismisses timed-out requests once and ignores later credentials', () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const callback = vi.fn();
    const state = new BrowserHttpAuthRequests(100, dismiss);
    state.add('first', 1, callback);
    vi.advanceTimersByTime(100);
    state.resolve('first', { username: 'late', password: 'late' });
    expect(dismiss).toHaveBeenCalledExactlyOnceWith({ id: 'first', guestId: 1 });
    expect(callback).toHaveBeenCalledExactlyOnceWith();
    expect(state.belongsTo('first', 1)).toBe(false);
  });

  it('cancels only the navigating or destroyed guest and clears every timer on disposal', () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    const state = new BrowserHttpAuthRequests(100, dismiss);
    state.add('first', 1, first);
    state.add('second', 2, second);
    state.cancelGuest(1);
    expect(first).toHaveBeenCalledExactlyOnceWith();
    expect(second).not.toHaveBeenCalled();
    expect(state.belongsTo('second', 1)).toBe(false);
    expect(state.belongsTo('second', 2)).toBe(true);
    state.dispose();
    expect(second).toHaveBeenCalledExactlyOnceWith();
    expect(dismiss).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives an Electron callback invalidated by frame destruction', () => {
    vi.useFakeTimers();
    const state = new BrowserHttpAuthRequests(100, vi.fn());
    state.add('gone', 1, () => {
      throw new Error('Frame destroyed');
    });
    expect(() => state.cancelGuest(1)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
