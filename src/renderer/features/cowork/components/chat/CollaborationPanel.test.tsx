// @vitest-environment jsdom
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoworkSession } from '@/features/cowork/coworkTypes';
import { i18nService } from '@/services/i18n';

vi.mock('@/features/cowork/coworkService', () => ({
  coworkService: { loadSessions: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('./CollaborationMemberHistory', () => ({
  default: ({ name }: { name: string }) => <div>History: {name}</div>,
}));
import CollaborationPanel, {
  CollaborationMemberLinks,
  useCollaborationRooms,
} from './CollaborationPanel';

afterEach(cleanup);
describe('collaboration member setup', () => {
  it('shows model-driven guidance without manual setup and opens participating agents', async () => {
    const room = {
      id: 'room',
      anchorSessionId: 'source',
      members: [
        { agentId: 'main', sessionId: 'source', sessionKey: 'agent:main:justdo:source' },
        {
          agentId: 'review',
          sessionId: 'review-session',
          sessionKey: 'agent:review:justdo:review-session',
        },
      ],
    };
    const create = vi.fn().mockResolvedValue({ success: true, value: { room, deliveries: [] } });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        collaboration: {
          read: vi.fn().mockResolvedValue({ success: true, value: { room, deliveries: [] } }),
          create,
        },
      },
    });
    const store = configureStore({
      reducer: {
        agent: () => ({
          agents: [
            { id: 'main', name: 'Main', enabled: true },
            { id: 'review', name: 'Review', enabled: true },
          ],
        }),
      },
    });
    const select = vi.fn();
    const { rerender } = render(
      <Provider store={store}>
        <CollaborationPanel
          source={{ id: 'source', agentId: 'main' } as CoworkSession}
          onSelect={select}
        />
      </Provider>,
    );
    await screen.findByRole('button', { name: 'Review' });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(select).toHaveBeenCalledWith('review-session');
    rerender(
      <Provider store={store}>
        <CollaborationPanel
          source={{ id: 'source', agentId: 'main' } as CoworkSession}
          selectedMemberId="review-session"
          onSelect={select}
        />
      </Provider>,
    );
    expect(await screen.findByText('History: Review')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: `← ${i18nService.t('collaborationOverview')}` }),
    );
    expect(select).toHaveBeenLastCalledWith(undefined);
  });
});

describe('collaboration room refresh', () => {
  it.each(['rejected', 'unsuccessful', 'late failure'])(
    'recovers automatic opening after a %s initial query',
    async failure => {
      const makeRoom = (id: string) => ({ id, anchorSessionId: id, members: [] });
      let rooms = [makeRoom('historic')];
      let refresh!: () => void;
      let rejectInitial!: (error: Error) => void;
      const list = vi.fn(async () => ({ success: true, value: rooms }));
      if (failure === 'rejected') list.mockRejectedValueOnce(new Error('not ready'));
      else if (failure === 'unsuccessful')
        list.mockResolvedValueOnce({ success: false, value: [] });
      else
        list.mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectInitial = reject;
            }),
        );
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: {
          collaboration: { list },
          cowork: {
            onSessionsChanged: (listener: () => void) => {
              refresh = listener;
              return vi.fn();
            },
          },
        },
      });
      const open = vi.fn();
      renderHook(() =>
        useCollaborationRooms({ activeSessionId: 'foreground', onFirstCollaboration: open }),
      );
      await act(async () => {});
      await act(async () => refresh());
      if (failure === 'late failure') await act(async () => rejectInitial(new Error('not ready')));
      expect(open).not.toHaveBeenCalled();
      rooms = [...rooms, makeRoom('foreground')];
      await act(async () => refresh());
      expect(open).toHaveBeenCalledExactlyOnceWith('foreground');
    },
  );

  it('shares one room query and one native listener across all consumers', async () => {
    const unsubscribe = vi.fn();
    const list = vi.fn(async () => ({ success: true as const, value: [] }));
    const onSessionsChanged = vi.fn(() => unsubscribe);
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { collaboration: { list }, cowork: { onSessionsChanged } },
    });

    const first = renderHook(useCollaborationRooms);
    const second = renderHook(useCollaborationRooms);
    await act(async () => {});
    expect(list).toHaveBeenCalledOnce();
    expect(onSessionsChanged).toHaveBeenCalledOnce();
    first.unmount();
    expect(unsubscribe).not.toHaveBeenCalled();
    second.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not reopen an already observed room when a foreground consumer remounts', async () => {
    const makeRoom = (id: string) => ({ id, anchorSessionId: id, members: [] });
    let rooms = [makeRoom('historic')];
    let refresh!: () => void;
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        collaboration: { list: vi.fn(async () => ({ success: true, value: rooms })) },
        cowork: {
          onSessionsChanged: (listener: () => void) => {
            refresh = listener;
            return vi.fn();
          },
        },
      },
    });
    const keeper = renderHook(useCollaborationRooms);
    await act(async () => {});
    rooms = [...rooms, makeRoom('existing')];
    await act(async () => refresh());

    const open = vi.fn();
    const foreground = renderHook(() =>
      useCollaborationRooms({ activeSessionId: 'existing', onFirstCollaboration: open }),
    );
    await act(async () => {});
    expect(open).not.toHaveBeenCalled();
    foreground.unmount();
    keeper.unmount();
  });

  it('opens only newly observed foreground collaboration, never initial or background rooms', async () => {
    const makeRoom = (id: string) => ({ id, anchorSessionId: id, members: [] });
    let rooms = [makeRoom('historic')];
    let refresh!: () => void;
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        collaboration: { list: vi.fn(async () => ({ success: true, value: rooms })) },
        cowork: {
          onSessionsChanged: (listener: () => void) => {
            refresh = listener;
            return vi.fn();
          },
        },
      },
    });
    const open = vi.fn();
    const { rerender } = renderHook(
      ({ id }) => useCollaborationRooms({ activeSessionId: id, onFirstCollaboration: open }),
      { initialProps: { id: 'historic' } },
    );
    await act(async () => {});
    expect(open).not.toHaveBeenCalled();
    rerender({ id: 'foreground' });
    rooms = [...rooms, makeRoom('foreground'), makeRoom('background')];
    await act(async () => refresh());
    expect(open).toHaveBeenCalledExactlyOnceWith('foreground');
    // Dismissing the panel has no effect on observation: subsequent refresh cannot reopen it.
    await act(async () => refresh());
    rerender({ id: 'background' });
    await act(async () => refresh());
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('does not open a room when the user switches sessions during refresh', async () => {
    let refresh!: () => void;
    let resolve!: (value: unknown) => void;
    const list = vi
      .fn()
      .mockResolvedValueOnce({ success: true, value: [] })
      .mockImplementation(
        () =>
          new Promise(done => {
            resolve = done;
          }),
      );
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        collaboration: { list },
        cowork: {
          onSessionsChanged: (listener: () => void) => {
            refresh = listener;
            return vi.fn();
          },
        },
      },
    });
    const open = vi.fn();
    const { rerender } = renderHook(
      ({ id }) => useCollaborationRooms({ activeSessionId: id, onFirstCollaboration: open }),
      { initialProps: { id: 'a' } },
    );
    await act(async () => {});
    act(() => refresh());
    rerender({ id: 'b' });
    await act(async () =>
      resolve({ success: true, value: [{ id: 'room', anchorSessionId: 'a', members: [] }] }),
    );
    expect(open).not.toHaveBeenCalled();
  });
  it('keeps newly joined members when an older room snapshot finishes last', async () => {
    const room = {
      id: 'room',
      anchorSessionId: 'source',
      members: [
        { agentId: 'main', sessionId: 'source', sessionKey: 'agent:main:justdo:source' },
        { agentId: 'review', sessionId: 'peer', sessionKey: 'agent:review:justdo:peer' },
      ],
    };
    type RoomResult = { success: true; value: (typeof room)[] };
    let resolveOld!: (value: RoomResult) => void;
    let resolveLatest!: (value: RoomResult) => void;
    const oldRequest = new Promise<RoomResult>(resolve => {
      resolveOld = resolve;
    });
    const latestRequest = new Promise<RoomResult>(resolve => {
      resolveLatest = resolve;
    });
    let sessionsChanged: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const list = vi.fn().mockReturnValueOnce(oldRequest).mockReturnValueOnce(latestRequest);
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        collaboration: { list },
        cowork: {
          onSessionsChanged: (listener: () => void) => {
            sessionsChanged = listener;
            return unsubscribe;
          },
        },
      },
    });
    const { result, unmount } = renderHook(useCollaborationRooms);
    act(() => sessionsChanged?.());
    await act(async () => resolveLatest({ success: true, value: [room] }));
    expect(result.current).toEqual([room]);
    await act(async () => resolveOld({ success: true, value: [] }));
    expect(result.current).toEqual([room]);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('persistent collaboration graph entry', () => {
  it('opens an existing collaboration and remains available after closing its panel', async () => {
    const room = {
      id: 'existing-room',
      anchorSessionId: 'main-session',
      members: [
        { agentId: 'main', sessionId: 'main-session' },
        { agentId: 'review', sessionId: 'review-session' },
      ],
    };
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        collaboration: { list: vi.fn().mockResolvedValue({ success: true, value: [room] }) },
      },
    });
    const open = vi.fn();
    const { rerender } = render(
      <CollaborationMemberLinks sessionId="main-session" onOpen={open} />,
    );
    const button = await screen.findByRole('button', {
      name: i18nService.t('collaborationOverview'),
    });
    expect(button.textContent).toContain('2');
    fireEvent.click(button);
    rerender(<CollaborationMemberLinks sessionId="main-session" onOpen={open} />);
    fireEvent.click(screen.getByRole('button', { name: i18nService.t('collaborationOverview') }));
    expect(open).toHaveBeenCalledTimes(2);
    rerender(<CollaborationMemberLinks sessionId="unrelated-session" onOpen={open} />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<CollaborationMemberLinks sessionId="main-session" onOpen={open} />);
    expect(
      screen.getByRole('button', { name: i18nService.t('collaborationOverview') }),
    ).toBeTruthy();
  });

  it('recognizes the anchor even if a room snapshot only contains its peers', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        collaboration: {
          list: vi.fn().mockResolvedValue({
            success: true,
            value: [
              {
                id: 'room',
                anchorSessionId: 'main-session',
                members: [{ agentId: 'review', sessionId: 'review-session' }],
              },
            ],
          }),
        },
      },
    });
    render(<CollaborationMemberLinks sessionId="main-session" onOpen={vi.fn()} />);
    expect(
      await screen.findByRole('button', { name: i18nService.t('collaborationOverview') }),
    ).toBeTruthy();
  });
});
