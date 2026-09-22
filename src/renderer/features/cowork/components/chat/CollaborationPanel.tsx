import { ShareIcon } from '@heroicons/react/24/outline';
import type { CollaborationRoom, CollaborationSnapshot } from '@shared/cowork/collaboration';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSelector } from 'react-redux';

import type { CoworkSession, CoworkSessionStatus } from '@/features/cowork/coworkTypes';
import { i18nService } from '@/services/i18n';
import type { RootState } from '@/store';

import type { Subtask } from '../subagents/subtaskPresentation';
import CollaborationGraph from './CollaborationGraph';
import CollaborationMemberHistory from './CollaborationMemberHistory';
import { COLLABORATION_PALETTE } from './collaborationPalette';

const STATUS_LABELS: Record<CoworkSessionStatus, string> = {
  idle: 'collaborationIdle',
  running: 'coworkStatusRunning',
  completed: 'collaborationIdle',
  error: 'coworkStatusError',
};
const EMPTY_SESSIONS: never[] = [];

export const COLLABORATION_CHANGED = 'cowork:collaboration-changed';

type CollaborationRoomsSnapshot = {
  rooms: CollaborationRoom[];
  baselineRoomIds: readonly string[] | null;
  revision: number;
};

const EMPTY_ROOMS_SNAPSHOT: CollaborationRoomsSnapshot = {
  rooms: [],
  baselineRoomIds: null,
  revision: 0,
};
let roomsSnapshot = EMPTY_ROOMS_SNAPSHOT;
let roomsRequestId = 0;
let roomsBaselineRequestId = 0;
let roomsStarted = false;
let unsubscribeRoomsChanged: (() => void) | undefined;
const roomSubscribers = new Set<() => void>();

function emitRoomsSnapshot(next: CollaborationRoomsSnapshot): void {
  roomsSnapshot = next;
  for (const subscriber of roomSubscribers) subscriber();
}

function refreshCollaborationRooms(): void {
  const currentRequestId = ++roomsRequestId;
  const request = window.electron?.collaboration?.list?.();
  if (!request) return;
  const failBaseline = () => {
    if (!roomsStarted || currentRequestId !== roomsBaselineRequestId) return;
    roomsBaselineRequestId = 0;
    // A newer successful response may already have arrived while startup failed.
    if (roomsSnapshot.revision > 0 && roomsSnapshot.baselineRoomIds === null)
      emitRoomsSnapshot({
        ...roomsSnapshot,
        baselineRoomIds: roomsSnapshot.rooms.map(room => room.id),
        revision: roomsSnapshot.revision + 1,
      });
  };
  void request
    .then(result => {
      if (!roomsStarted) return;
      if (!result.success) {
        failBaseline();
        return;
      }
      const isBaselineRequest = currentRequestId === roomsBaselineRequestId;
      const isLatestRequest = currentRequestId === roomsRequestId;
      if (!isBaselineRequest && !isLatestRequest) return;
      emitRoomsSnapshot({
        rooms: isLatestRequest ? result.value : roomsSnapshot.rooms,
        baselineRoomIds:
          isBaselineRequest ||
          (roomsBaselineRequestId === 0 && roomsSnapshot.baselineRoomIds === null)
            ? result.value.map(room => room.id)
            : roomsSnapshot.baselineRoomIds,
        revision: roomsSnapshot.revision + 1,
      });
    })
    .catch(failBaseline);
}

function startCollaborationRooms(): void {
  if (roomsStarted) return;
  roomsStarted = true;
  roomsBaselineRequestId = roomsRequestId + 1;
  refreshCollaborationRooms();
  unsubscribeRoomsChanged = window.electron?.cowork?.onSessionsChanged?.(refreshCollaborationRooms);
  window.addEventListener(COLLABORATION_CHANGED, refreshCollaborationRooms);
}

function stopCollaborationRooms(): void {
  if (!roomsStarted) return;
  roomsStarted = false;
  roomsRequestId += 1;
  roomsBaselineRequestId = 0;
  unsubscribeRoomsChanged?.();
  unsubscribeRoomsChanged = undefined;
  window.removeEventListener(COLLABORATION_CHANGED, refreshCollaborationRooms);
  roomsSnapshot = EMPTY_ROOMS_SNAPSHOT;
}

function subscribeCollaborationRooms(subscriber: () => void): () => void {
  roomSubscribers.add(subscriber);
  startCollaborationRooms();
  return () => {
    roomSubscribers.delete(subscriber);
    if (!roomSubscribers.size) stopCollaborationRooms();
  };
}

function useCollaborationRoomsSnapshot(): CollaborationRoomsSnapshot {
  return useSyncExternalStore(
    subscribeCollaborationRooms,
    () => roomsSnapshot,
    () => EMPTY_ROOMS_SNAPSHOT,
  );
}

export function useCollaborationRooms(options?: {
  activeSessionId: string | null;
  onFirstCollaboration: (sessionId: string) => void;
}): CollaborationRoom[] {
  const snapshot = useCollaborationRoomsSnapshot();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const observedRoomIds = useRef<Set<string>>();
  const mountedBeforeBaseline = useRef(snapshot.baselineRoomIds === null);
  useEffect(() => {
    if (!snapshot.baselineRoomIds) return;
    observedRoomIds.current ??= new Set(
      mountedBeforeBaseline.current
        ? snapshot.baselineRoomIds
        : snapshot.rooms.map(room => room.id),
    );
    const activeSessionId = optionsRef.current?.activeSessionId ?? null;
    const newRoom = snapshot.rooms.find(
      room => !observedRoomIds.current!.has(room.id) && room.anchorSessionId === activeSessionId,
    );
    // Keep observed IDs after removal too: a later refresh must not reopen a dismissed panel.
    for (const room of snapshot.rooms) observedRoomIds.current.add(room.id);
    if (newRoom && activeSessionId === optionsRef.current?.activeSessionId) {
      optionsRef.current?.onFirstCollaboration(newRoom.anchorSessionId);
    }
  }, [snapshot]);
  return snapshot.rooms;
}

export function CollaborationMemberLinks({
  sessionId,
  onOpen,
}: {
  sessionId: string;
  onOpen: () => void;
}) {
  const rooms = useCollaborationRooms();
  const room = rooms.find(
    item =>
      item.anchorSessionId === sessionId ||
      item.members.some(member => member.sessionId === sessionId),
  );
  if (!room) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={i18nService.t('collaborationOverview')}
      aria-label={i18nService.t('collaborationOverview')}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-secondary hover:bg-surface-raised hover:text-foreground"
    >
      <ShareIcon className="h-[18px] w-[18px]" aria-hidden="true" />
      <span>{i18nService.t('collaborationTab')}</span>
      <span className="text-[10px] tabular-nums">{room.members.length}</span>
    </button>
  );
}

export default function CollaborationPanel({
  source,
  selectedMemberId,
  onSelect,
  onOpenSubtask,
}: {
  source: CoworkSession;
  selectedMemberId?: string;
  onSelect: (sessionId: string | undefined) => void;
  onOpenSubtask?: (task: Subtask, parentSessionId: string) => void;
}) {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const sessions = useSelector((state: RootState) => state.cowork?.sessions ?? EMPTY_SESSIONS);
  const [loaded, setLoaded] = useState<{ sessionId: string; snapshot: CollaborationSnapshot }>();
  const snapshot = loaded?.sessionId === source.id ? loaded.snapshot : undefined;
  const [error, setError] = useState('');
  const [receiptId, setReceiptId] = useState<string>();
  const messageTextCache = useRef(new Map<string, string>());
  const messageTextCacheRoomId = useRef<string>();
  const roomRevision = useCollaborationRoomsSnapshot().revision;
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const result = await window.electron.collaboration.read(source.id);
        if (disposed) return;
        if (result.success) {
          setLoaded({ sessionId: source.id, snapshot: result.value });
          setError('');
        } else setError(result.error);
      } catch {
        if (!disposed) setError('collaborationRuntimeUnavailable');
      }
    };
    void refresh();
    return () => {
      disposed = true;
    };
  }, [roomRevision, source.id]);
  const room = snapshot?.room;
  if (messageTextCacheRoomId.current !== room?.id) {
    messageTextCacheRoomId.current = room?.id;
    messageTextCache.current.clear();
  }
  const activeReceipt =
    !selectedMemberId && receiptId
      ? snapshot?.deliveries.find(delivery => delivery.id === receiptId)
      : undefined;
  const detailMemberId =
    selectedMemberId ||
    (activeReceipt
      ? room?.members.find(member => member.agentId === activeReceipt.to)?.sessionId
      : undefined);
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-surface"
      aria-label={i18nService.t('collaborationTab')}
    >
      <div className="border-b border-border px-4 py-3">
        {detailMemberId ? (
          <button
            type="button"
            onClick={() => {
              setReceiptId(undefined);
              onSelect(undefined);
            }}
            className="text-sm text-primary"
          >
            ← {i18nService.t('collaborationOverview')}
          </button>
        ) : (
          <h2 className="text-sm font-semibold">{i18nService.t('collaborationOverview')}</h2>
        )}
      </div>
      <div
        className={`min-h-0 flex-1 ${room && !detailMemberId ? 'overflow-hidden' : 'overflow-auto p-3'}`}
      >
        {error && (
          <p role="alert" className="my-3 text-sm text-red-500">
            {i18nService.t(error)}
          </p>
        )}
        {room &&
        detailMemberId &&
        room.members.some(member => member.sessionId === detailMemberId) ? (
          <CollaborationMemberHistory
            key={detailMemberId}
            onOpenSubtask={onOpenSubtask}
            anchorSessionId={room.anchorSessionId}
            member={room.members.find(member => member.sessionId === detailMemberId)!}
            name={
              agents.find(
                agent =>
                  agent.id ===
                  room.members.find(member => member.sessionId === detailMemberId)!.agentId,
              )?.name || ''
            }
            receipt={
              activeReceipt &&
              activeReceipt.roomId === room.id &&
              room.members.find(member => member.sessionId === detailMemberId)?.agentId ===
                activeReceipt.to
                ? {
                    deliveryId: activeReceipt.id,
                    id: activeReceipt.runId || activeReceipt.id,
                  }
                : undefined
            }
            workingDirectory={source.cwd}
            peerColors={Object.fromEntries(
              room.members.map((member, index) => [
                member.agentId,
                COLLABORATION_PALETTE[index % COLLABORATION_PALETTE.length].stroke,
              ]),
            )}
            peerNames={Object.fromEntries(
              room.members.map(member => [
                member.agentId,
                agents.find(agent => agent.id === member.agentId)?.name || member.agentId,
              ]),
            )}
          />
        ) : room ? (
          <>
            <CollaborationGraph
              room={room}
              deliveries={snapshot.deliveries}
              names={Object.fromEntries(agents.map(agent => [agent.id, agent.name]))}
              statuses={Object.fromEntries(
                sessions.map(session => [session.id, i18nService.t(STATUS_LABELS[session.status])]),
              )}
              onSelectMember={id => {
                setReceiptId(undefined);
                onSelect(id);
              }}
              onSelectMessage={delivery => {
                const target = room.members.find(member => member.agentId === delivery.to);
                if (target) {
                  setReceiptId(delivery.id);
                  onSelect(undefined);
                }
              }}
              messageTextCache={messageTextCache.current}
            />
          </>
        ) : (
          snapshot && (
            <>
              <p className="my-4 text-sm text-secondary">
                {i18nService.t('collaborationSetupHelp')}
              </p>
            </>
          )
        )}
      </div>
    </section>
  );
}
