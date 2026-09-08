/**
 * JustDoChatWrapper — React component that manages the <justdo-chat> Lit element.
 *
 * Creates a ChatController that connects directly to the OpenClaw gateway
 * (same approach as the webchat). Passes the controller to the Lit element.
 *
 * This replaces the Redux → CoworkMessage → gateway conversion approach
 * with a direct gateway connection, identical to OpenClaw's webchat.
 */
import type { SessionRunTiming } from '@shared/cowork/sessionRun';
import type { CoworkSessionSegment } from '@shared/cowork/sessionSegment';
import type { ProgressCardViewState } from '@shared/openclaw/progressCard';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useSelector } from 'react-redux';

import ChatMessageDisplay from '@/features/cowork/components/chat/ChatMessageDisplay';
import {
  buildGoalRunProgress,
  type GoalRunProgress,
  goalRunProgressKey,
} from '@/features/cowork/components/goals/goalRunProgress';
import { selectCurrentSession } from '@/features/cowork/coworkSelectors';
import type { CoworkAttachmentPayload, CoworkSession } from '@/features/cowork/coworkTypes';
import {
  type ChatContextUsageSnapshot,
  ChatController,
} from '@/libs/openclaw-chat/gateway/chat-controller';
import { i18nService } from '@/services/i18n';

const DEBUG_CHAT_WRAPPER =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEBUG_CHAT_WRAPPER === 'true';

function debugLog(...args: unknown[]): void {
  if (DEBUG_CHAT_WRAPPER) {
    console.debug(...args);
  }
}

interface JustDoChatWrapperProps {
  className?: string;
  assistantName?: string;
  workingDirectory?: string;
  searchQuery?: string;
  searchCaseSensitive?: boolean;
  searchNavigationToken?: number;
  searchNavigationDirection?: 1 | -1;
  processSummariesExpanded?: boolean;
  onSearchMatchCountChange?: (total: number, index: number) => void;
  onActivityChange?: (progress: GoalRunProgress | null) => void;
  onContextUsageChange?: (usage: ChatContextUsageSnapshot | null) => void;
  onProgressCardChange?: (state: ProgressCardViewState | null) => void;
  onSessionKeyChange?: (sessionKey: string) => void;
  runTimings?: SessionRunTiming[];
}

type SegmentLoadState = {
  logicalSessionId: string | null;
  status: 'loading' | 'ready' | 'error';
  sessionKey: string | null;
};

type HistoryPrefixState = {
  logicalSessionId: string | null;
  status: 'loading' | 'ready' | 'error';
  messages: unknown[];
};

export interface JustDoChatWrapperRef {
  sendMessage: (
    text: string,
    attachments?: CoworkAttachmentPayload[],
    gatewayMessage?: string,
    options?: {
      propagateRequestFailure?: boolean;
      expectedSessionKey?: string;
      isCancelled?: () => boolean;
      onRequestUnknown?: (runId: string) => void | Promise<void>;
      clientTurnId?: string;
      onRunBound?: (runId: string) => void | Promise<void>;
    },
  ) => Promise<void>;
  getExportSnapshot: () => {
    messages: unknown[];
    runtimeSessionId: string | null;
    isLoading: boolean;
  };
  /** Set an optimistic user message shown until gateway history loads */
  setPendingUserMessage: (text: string, attachments?: CoworkAttachmentPayload[]) => void;
  /** Register the exact temporary/canonical pair created for a new session. */
  registerSessionPromotion: (sourceSessionKey: string, targetSessionKey: string) => void;
  /** Clear sending state (e.g. when session start fails) */
  cancelManualCompaction: (sessionKey: string) => Promise<void>;
  settleConfirmedRun: (
    sessionKey: string,
    runId: string,
    state: 'completed' | 'failed' | 'aborted',
  ) => void;
  getSendingRunId: () => string | null;
  clearSending: (expectedSessionKey?: string, expectedRunId?: string | null) => void;
  /** Adopt an accepted Goal resume before its first stream event arrives. */
  beginGoalResume: (sessionKey: string, runId: string) => void;
  /** Clear the current card only if its completed revision is still current. */
  dismissProgressCard: () => Promise<boolean>;
}

const JustDoChatWrapper = forwardRef<JustDoChatWrapperRef, JustDoChatWrapperProps>(
  (
    {
      className,
      assistantName,
      workingDirectory,
      searchQuery,
      searchCaseSensitive,
      searchNavigationToken,
      searchNavigationDirection,
      processSummariesExpanded,
      onSearchMatchCountChange,
      onActivityChange,
      onContextUsageChange,
      onProgressCardChange,
      onSessionKeyChange,
      runTimings = [],
    },
    ref,
  ) => {
    const currentSession = useSelector(selectCurrentSession) as CoworkSession | null;
    const currentSessionId = currentSession?.id;
    const currentSessionAgentId = currentSession?.agentId;
    const canonicalSessionKey = currentSessionId
      ? `agent:${currentSessionAgentId?.trim() || 'main'}:justdo:${currentSessionId}`
      : null;
    const initialSessionRef = useRef(currentSession);
    const controllerRef = useRef<ChatController | null>(null);
    const [controller, setController] = useState<ChatController | null>(null);
    const connectedRef = useRef(false);
    const onActivityChangeRef = useRef(onActivityChange);
    const onContextUsageChangeRef = useRef(onContextUsageChange);
    const onProgressCardChangeRef = useRef(onProgressCardChange);
    const onSessionKeyChangeRef = useRef(onSessionKeyChange);
    const lastActivityKeyRef = useRef('');
    const lastContextUsageKeyRef = useRef('');
    const lastProgressCardKeyRef = useRef('');
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [historyPrefix, setHistoryPrefix] = useState<HistoryPrefixState>({
      logicalSessionId: currentSessionId ?? null,
      status: 'loading',
      messages: [],
    });
    const historyPrefixRef = useRef<HistoryPrefixState>(historyPrefix);
    const segmentRoutingRef = useRef<SegmentLoadState>({
      logicalSessionId: currentSessionId ?? null,
      status: 'loading',
      sessionKey: null,
    });
    const segmentRefreshGenerationRef = useRef(0);
    const segmentRefreshRetryCountRef = useRef(new Map<string, number>());
    const currentSessionIdentityRef = useRef({
      sessionId: currentSessionId ?? null,
      canonicalSessionKey,
    });
    if (currentSessionIdentityRef.current.sessionId !== (currentSessionId ?? null)) {
      segmentRefreshGenerationRef.current += 1;
      currentSessionIdentityRef.current = {
        sessionId: currentSessionId ?? null,
        canonicalSessionKey,
      };
      segmentRoutingRef.current = {
        logicalSessionId: currentSessionId ?? null,
        status: 'loading',
        sessionKey: null,
      };
      historyPrefixRef.current = {
        logicalSessionId: currentSessionId ?? null,
        status: 'loading',
        messages: [],
      };
    } else {
      currentSessionIdentityRef.current.canonicalSessionKey = canonicalSessionKey;
    }
    const [activeSegment, setActiveSegment] = useState<{
      logicalSessionId: string;
      sessionKey: string;
    } | null>(null);
    // Buffer for pending user message when the controller is not yet created
    const pendingUserMessageRef = useRef<{
      text: string;
      attachments: CoworkAttachmentPayload[];
    } | null>(null);
    const promotionSourceByTargetRef = useRef(new Map<string, string>());
    const lastReportedSessionKeyRef = useRef('');

    const refreshTranscriptSegments = useCallback(
      async (controller: ChatController, sessionId: string): Promise<void> => {
        if (currentSessionIdentityRef.current.sessionId !== sessionId) return;
        const generation = ++segmentRefreshGenerationRef.current;
        const loadingRoute: SegmentLoadState = {
          logicalSessionId: sessionId,
          status: 'loading',
          sessionKey: null,
        };
        const loadingPrefix: HistoryPrefixState = {
          logicalSessionId: sessionId,
          status: 'loading',
          messages: [],
        };
        segmentRoutingRef.current = loadingRoute;
        historyPrefixRef.current = loadingPrefix;
        setHistoryPrefix(loadingPrefix);
        const scheduleSegmentRetry = () => {
          const retryCount = segmentRefreshRetryCountRef.current.get(sessionId) ?? 0;
          if (retryCount >= 2) return;
          segmentRefreshRetryCountRef.current.set(sessionId, retryCount + 1);
          window.setTimeout(() => {
            if (
              controllerRef.current === controller &&
              connectedRef.current &&
              currentSessionIdentityRef.current.sessionId === sessionId
            ) {
              void refreshTranscriptSegments(controller, sessionId);
            }
          }, 1_000);
        };
        const failSegmentLoad = () => {
          if (
            generation !== segmentRefreshGenerationRef.current ||
            currentSessionIdentityRef.current.sessionId !== sessionId
          ) {
            return;
          }
          segmentRoutingRef.current = { ...loadingRoute, status: 'error' };
          const failedPrefix = { ...loadingPrefix, status: 'error' as const };
          historyPrefixRef.current = failedPrefix;
          setHistoryPrefix(failedPrefix);
          scheduleSegmentRetry();
        };
        const cowork = window.electron?.cowork as
          | (typeof window.electron.cowork & {
              listSessionSegments?: (sessionId: string) => Promise<{
                success: boolean;
                segments?: CoworkSessionSegment[];
              }>;
            })
          | undefined;
        const result = await cowork?.listSessionSegments?.(sessionId).catch(() => null);
        if (
          generation !== segmentRefreshGenerationRef.current ||
          currentSessionIdentityRef.current.sessionId !== sessionId
        ) {
          return;
        }
        if (!result?.success) {
          failSegmentLoad();
          return;
        }
        const segments = (result.segments ?? [])
          .slice()
          .sort((left, right) => left.ordinal - right.ordinal);
        if (segments.length === 0) {
          const sessionKey = currentSessionIdentityRef.current.canonicalSessionKey;
          if (!sessionKey || currentSessionIdentityRef.current.sessionId !== sessionId) return;
          try {
            if (controller.state.sessionKey !== sessionKey)
              await controller.switchSession(sessionKey);
          } catch {
            failSegmentLoad();
            return;
          }
          if (
            generation !== segmentRefreshGenerationRef.current ||
            currentSessionIdentityRef.current.sessionId !== sessionId
          ) {
            return;
          }
          segmentRoutingRef.current = {
            logicalSessionId: sessionId,
            status: 'ready',
            sessionKey,
          };
          setActiveSegment(null);
          const emptyPrefix: HistoryPrefixState = {
            logicalSessionId: sessionId,
            status: 'ready',
            messages: [],
          };
          historyPrefixRef.current = emptyPrefix;
          setHistoryPrefix(emptyPrefix);
          return;
        }

        const active = [...segments].reverse().find(segment => segment.endedAt === undefined);
        if (!active) {
          failSegmentLoad();
          return;
        }
        const closed = segments.filter(segment => segment.ordinal < active.ordinal);
        if (controller.state.sessionKey !== active.sessionKey) {
          const currentClosed = closed.find(
            segment => segment.sessionKey === controller.state.sessionKey,
          );
          if (currentClosed) {
            const immediatePrefix = [
              ...(controller.getLoadedMessages() as unknown[]),
              createPhaseBoundaryMessage(active),
            ];
            const immediateState: HistoryPrefixState = {
              logicalSessionId: sessionId,
              status: 'loading',
              messages: immediatePrefix,
            };
            historyPrefixRef.current = immediateState;
            setHistoryPrefix(immediateState);
          }
          try {
            await controller.switchSession(active.sessionKey);
          } catch {
            failSegmentLoad();
            return;
          }
        }
        if (
          generation !== segmentRefreshGenerationRef.current ||
          currentSessionIdentityRef.current.sessionId !== sessionId
        ) {
          return;
        }
        segmentRoutingRef.current = {
          logicalSessionId: sessionId,
          status: 'ready',
          sessionKey: active.sessionKey,
        };
        setActiveSegment({ logicalSessionId: sessionId, sessionKey: active.sessionKey });

        const prefix: unknown[] = [];
        try {
          for (let index = 0; index < closed.length; index += 1) {
            const segment = closed[index];
            const messages = await controller.loadTranscriptSegment(segment.sessionKey);
            const nextSegment = segments[index + 1];
            prefix.push(...messages);
            if (nextSegment) prefix.push(createPhaseBoundaryMessage(nextSegment));
          }
        } catch {
          if (
            generation !== segmentRefreshGenerationRef.current ||
            currentSessionIdentityRef.current.sessionId !== sessionId
          ) {
            return;
          }
          const failedPrefix: HistoryPrefixState = {
            logicalSessionId: sessionId,
            status: 'error',
            messages: prefix,
          };
          historyPrefixRef.current = failedPrefix;
          setHistoryPrefix(failedPrefix);
          scheduleSegmentRetry();
          return;
        }
        if (
          generation === segmentRefreshGenerationRef.current &&
          currentSessionIdentityRef.current.sessionId === sessionId
        ) {
          const readyPrefix: HistoryPrefixState = {
            logicalSessionId: sessionId,
            status: 'ready',
            messages: prefix,
          };
          historyPrefixRef.current = readyPrefix;
          setHistoryPrefix(readyPrefix);
          segmentRefreshRetryCountRef.current.delete(sessionId);
        }
      },
      [],
    );

    useEffect(() => {
      onActivityChangeRef.current = onActivityChange;
    }, [onActivityChange]);

    useEffect(() => {
      onContextUsageChangeRef.current = onContextUsageChange;
    }, [onContextUsageChange]);

    useEffect(() => {
      onProgressCardChangeRef.current = onProgressCardChange;
    }, [onProgressCardChange]);

    useEffect(() => {
      onSessionKeyChangeRef.current = onSessionKeyChange;
    }, [onSessionKeyChange]);

    // Expose sendMessage and setPendingUserMessage to parent via ref
    useImperativeHandle(
      ref,
      () => ({
        getExportSnapshot: () => {
          const controller = controllerRef.current;
          const sessionId = currentSessionIdentityRef.current.sessionId;
          const routing = segmentRoutingRef.current;
          const prefix = historyPrefixRef.current;
          const lineageLoading =
            !sessionId ||
            routing.logicalSessionId !== sessionId ||
            routing.status !== 'ready' ||
            !routing.sessionKey ||
            controller?.state.sessionKey !== routing.sessionKey ||
            prefix.logicalSessionId !== sessionId ||
            prefix.status !== 'ready';
          return {
            messages: controller
              ? [
                  ...(prefix.logicalSessionId === sessionId ? prefix.messages : []),
                  ...controller.getLoadedMessages(),
                ]
              : [],
            runtimeSessionId: controller?.state.currentSessionId ?? null,
            isLoading:
              lineageLoading || !controller?.state.connected || controller.state.chatLoading,
          };
        },
        sendMessage: async (text: string, attachments = [], gatewayMessage, options) => {
          const controller = controllerRef.current;
          if (!controller) throw new Error('Controller not initialized');
          const sessionId = currentSessionIdentityRef.current.sessionId;
          const routing = segmentRoutingRef.current;
          if (
            !sessionId ||
            routing.logicalSessionId !== sessionId ||
            routing.status !== 'ready' ||
            !routing.sessionKey ||
            controller.state.sessionKey !== routing.sessionKey
          ) {
            throw new Error(i18nService.t('coworkSessionRoutingLoading'));
          }
          await controller.sendMessage(text, attachments, gatewayMessage, options);
        },
        setPendingUserMessage: (text: string, attachments = []) => {
          const controller = controllerRef.current;
          // Always buffer the prompt — survives StrictMode remounts where the
          // controller is destroyed and recreated.
          pendingUserMessageRef.current = { text, attachments };
          if (controller) {
            debugLog('[JustDoChatWrapper] setPendingUserMessage (immediate):', text.slice(0, 60));
            controller.setPendingUserMessage(text, attachments);
          } else {
            debugLog(
              '[JustDoChatWrapper] setPendingUserMessage (buffered, no controller):',
              text.slice(0, 60),
            );
          }
        },
        registerSessionPromotion: (sourceSessionKey: string, targetSessionKey: string) => {
          promotionSourceByTargetRef.current.set(targetSessionKey, sourceSessionKey);
        },
        cancelManualCompaction: async sessionKey => {
          await controllerRef.current?.cancelManualCompaction(sessionKey);
        },
        settleConfirmedRun: (sessionKey, runId, state) => {
          controllerRef.current?.settleConfirmedRun(sessionKey, runId, state);
        },
        getSendingRunId: () => controllerRef.current?.state.chatRunId ?? null,
        clearSending: (expectedSessionKey, expectedRunId) => {
          controllerRef.current?.clearSending(expectedSessionKey, expectedRunId);
        },
        beginGoalResume: (sessionKey: string, runId: string) => {
          controllerRef.current?.beginGoalResume(sessionKey, runId);
        },
        dismissProgressCard: async () => controllerRef.current?.dismissProgressCard() ?? false,
      }),
      [],
    );

    // Create the Lit element and controller on mount
    useEffect(() => {
      const controller = new ChatController();
      controllerRef.current = controller;
      setController(controller);

      const publishActivity = () => {
        if (controller.state.sessionKey !== lastReportedSessionKeyRef.current) {
          lastReportedSessionKeyRef.current = controller.state.sessionKey;
          onSessionKeyChangeRef.current?.(controller.state.sessionKey);
        }
        const progress = buildGoalRunProgress(controller.state);
        const key = goalRunProgressKey(progress);
        if (key !== lastActivityKeyRef.current) {
          lastActivityKeyRef.current = key;
          onActivityChangeRef.current?.(progress);
        }
        const usage = controller.state.contextUsage;
        const contextKey = usage
          ? [
              usage.sessionKey,
              usage.sessionId ?? '',
              usage.totalTokens,
              usage.contextTokens ?? '',
              usage.totalTokensFresh,
              usage.updatedAt ?? '',
              usage.modelRef ?? '',
            ].join(':')
          : '';
        if (contextKey !== lastContextUsageKeyRef.current) {
          lastContextUsageKeyRef.current = contextKey;
          onContextUsageChangeRef.current?.(usage);
        }
        const progressCardKey = [
          controller.state.sessionKey,
          controller.state.progressCard?.revision ?? 'none',
          controller.state.progressCardLoading,
          controller.state.progressCardAvailable,
          controller.state.progressCardError ?? '',
        ].join(':');
        if (progressCardKey !== lastProgressCardKeyRef.current) {
          lastProgressCardKeyRef.current = progressCardKey;
          onProgressCardChangeRef.current?.({
            sessionKey: controller.state.sessionKey,
            card: controller.state.progressCard,
            loading: controller.state.progressCardLoading,
            available: controller.state.progressCardAvailable,
            error: controller.state.progressCardError,
          });
        }
      };
      const unsubscribeState = controller.subscribe(publishActivity);
      const unsubscribeStream = controller.onStream(publishActivity);

      // Apply any buffered pending user message (set before controller existed)
      if (pendingUserMessageRef.current) {
        debugLog('[JustDoChatWrapper] applying buffered pendingUserMessage on mount');
        controller.setPendingUserMessage(
          pendingUserMessageRef.current.text,
          pendingUserMessageRef.current.attachments,
        );
        pendingUserMessageRef.current = null;
      }

      // Set initial sessionKey from current session BEFORE connecting
      // (avoids race with the session-switch effect)
      const initialSession = initialSessionRef.current;
      if (initialSession) {
        const agentId = initialSession.agentId?.trim() || 'main';
        const sessionKey = `agent:${agentId}:justdo:${initialSession.id}`;
        controller.state.sessionKey = sessionKey;
      }

      // Cancellation flag: React StrictMode double-fires mount effects.
      // If the cleanup runs before connectToGateway resolves, we must
      // disconnect the zombie controller that would otherwise survive.
      let cancelled = false;

      // Connect to gateway with proper error state tracking
      connectToGateway(controller)
        .then(success => {
          if (cancelled) {
            debugLog(
              '[JustDoChatWrapper] connectToGateway resolved after cleanup — disconnecting zombie',
            );
            controller.disconnect();
            return;
          }
          if (success) {
            connectedRef.current = true;
            setConnectionError(null);
            const sessionId = currentSessionIdentityRef.current.sessionId;
            if (sessionId) void refreshTranscriptSegments(controller, sessionId);
          } else {
            setConnectionError('Failed to connect to OpenClaw gateway');
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setConnectionError(err instanceof Error ? err.message : 'Unknown connection error');
        });

      return () => {
        cancelled = true;
        unsubscribeState();
        unsubscribeStream();
        lastActivityKeyRef.current = '';
        lastContextUsageKeyRef.current = '';
        lastProgressCardKeyRef.current = '';
        lastReportedSessionKeyRef.current = '';
        onActivityChangeRef.current?.(null);
        onContextUsageChangeRef.current?.(null);
        onProgressCardChangeRef.current?.(null);
        debugLog('[JustDoChatWrapper] cleanup — disconnecting controller');
        try {
          controller.disconnect();
        } catch {
          // Cleanup errors are non-fatal
        }
        controllerRef.current = null;
        setController(null);
        connectedRef.current = false;
      };
    }, [refreshTranscriptSegments]);

    useEffect(() => {
      const refresh = (event: Event) => {
        const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
        const controller = controllerRef.current;
        if (controller && sessionId && sessionId === currentSessionId) {
          void refreshTranscriptSegments(controller, sessionId);
        }
      };
      window.addEventListener('justdo:plan-implementation-started', refresh);
      return () => window.removeEventListener('justdo:plan-implementation-started', refresh);
    }, [currentSessionId, refreshTranscriptSegments]);

    useEffect(() => {
      const controller = controllerRef.current;
      if (!controller || !connectedRef.current || !currentSessionId) return;
      void refreshTranscriptSegments(controller, currentSessionId);
    }, [currentSessionId, refreshTranscriptSegments]);

    // Synchronize the imperative controller before the browser paints the new
    // Redux session. A passive effect leaves one frame where the chat still
    // projects the previous/partial controller transcript; for a cold session
    // that can expose an assistant-only snapshot until Gateway history arrives.
    useLayoutEffect(() => {
      const controller = controllerRef.current;
      if (!controller || !currentSessionId) return;

      // Build the gateway session key (same format as the main-process session-key helpers).
      const agentId = currentSessionAgentId?.trim() || 'main';
      const sessionKey =
        activeSegment?.logicalSessionId === currentSessionId
          ? activeSegment.sessionKey
          : `agent:${agentId}:justdo:${currentSessionId}`;

      if (connectedRef.current && controller.state.sessionKey !== sessionKey) {
        const promoteFromSessionKey = promotionSourceByTargetRef.current.get(sessionKey);
        promotionSourceByTargetRef.current.delete(sessionKey);
        void controller.switchSession(sessionKey, { promoteFromSessionKey });
      } else if (!connectedRef.current && controller.state.sessionKey !== sessionKey) {
        const promoteFromSessionKey = promotionSourceByTargetRef.current.get(sessionKey);
        if (promoteFromSessionKey) {
          promotionSourceByTargetRef.current.delete(sessionKey);
          void controller.switchSession(sessionKey, { promoteFromSessionKey });
        } else {
          // Not yet connected — set sessionKey so connect() picks it up.
          controller.state.sessionKey = sessionKey;
        }
      }
    }, [activeSegment, currentSessionAgentId, currentSessionId]);

    if (connectionError) {
      return (
        <div
          className={`${className ?? ''} flex items-center justify-center`}
          style={{ flex: 1, minHeight: 0 }}
        >
          <div className="text-center space-y-3">
            <div className="text-red-500 text-sm">{connectionError}</div>
            <button
              type="button"
              onClick={() => {
                setConnectionError(null);
                const controller = controllerRef.current;
                if (controller) {
                  connectToGateway(controller)
                    .then(success => {
                      if (success) {
                        connectedRef.current = true;
                        const sessionId = currentSessionIdentityRef.current.sessionId;
                        if (sessionId) void refreshTranscriptSegments(controller, sessionId);
                      } else setConnectionError('Retry failed');
                    })
                    .catch(() => setConnectionError('Retry failed'));
                }
              }}
              className="px-3 py-1.5 text-xs rounded bg-surface-raised hover:bg-surface-raised/80 transition-colors"
            >
              Retry Connection
            </button>
          </div>
        </div>
      );
    }

    return (
      <ChatMessageDisplay
        className={className}
        controller={controller}
        assistantName={assistantName}
        workingDirectory={workingDirectory}
        searchQuery={searchQuery}
        searchCaseSensitive={searchCaseSensitive}
        searchNavigationToken={searchNavigationToken}
        searchNavigationDirection={searchNavigationDirection}
        processSummariesExpanded={processSummariesExpanded}
        onSearchMatchCountChange={onSearchMatchCountChange}
        runTimings={runTimings}
        historyPrefixMessages={
          historyPrefix.logicalSessionId === currentSessionId
            ? (historyPrefix.messages as import('@/libs/openclaw-chat/types').GatewayMessage[])
            : []
        }
      />
    );
  },
);

function createPhaseBoundaryMessage(segment: CoworkSessionSegment): unknown {
  return {
    role: 'justdo-phase-boundary',
    id: `phase-boundary:${segment.id}`,
    content: i18nService.t('planModeImplementationDivider'),
  };
}

// ─── Gateway Connection ─────────────────────────────────────────────────────

/** Typed access to the Electron preload bridge for OpenClaw engine info. */
interface OpenClawEngineBridge {
  getPort: () => Promise<{ success: boolean; port?: number }>;
  getToken: () => Promise<{ success: boolean; token?: string }>;
}

function getEngineBridge(): OpenClawEngineBridge | undefined {
  const electron = (window as unknown as Record<string, unknown>).electron as
    Record<string, unknown> | undefined;
  const openclaw = electron?.openclaw as Record<string, unknown> | undefined;
  return openclaw?.engine as OpenClawEngineBridge | undefined;
}

export async function connectToGateway(controller: ChatController): Promise<boolean> {
  const engine = getEngineBridge();
  if (!engine) {
    console.error('[JustDoChatWrapper] openclaw.engine API not available');
    return false;
  }

  const portResult = await engine.getPort();
  const tokenResult = await engine.getToken();

  if (!portResult?.success || !portResult.port) {
    console.error('[JustDoChatWrapper] Gateway port not available:', portResult);
    return false;
  }

  const url = `ws://127.0.0.1:${portResult.port}`;
  const token = tokenResult?.success ? tokenResult.token : undefined;

  // Use sessionKey already set on the controller (set by session-switch effect)
  const sessionKey = controller.state.sessionKey || 'agent:main:justdo:default';

  await controller.connect(url, token ?? '', sessionKey);
  return true;
}

export default JustDoChatWrapper;
