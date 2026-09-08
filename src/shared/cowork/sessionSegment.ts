export const CoworkSessionSegmentPhase = {
  Conversation: 'conversation',
  Planning: 'planning',
  Implementation: 'implementation',
} as const;

export type CoworkSessionSegmentPhase =
  (typeof CoworkSessionSegmentPhase)[keyof typeof CoworkSessionSegmentPhase];

export interface CoworkSessionSegment {
  id: string;
  sessionId: string;
  sessionKey: string;
  gatewaySessionId?: string;
  phase: CoworkSessionSegmentPhase;
  planId?: string;
  ordinal: number;
  startedAt: number;
  endedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface BeginCoworkSessionSegmentInput {
  id: string;
  sessionId: string;
  sessionKey: string;
  phase: CoworkSessionSegmentPhase;
  startedAt: number;
  gatewaySessionId?: string;
  planId?: string;
}

export interface ParsedCoworkSessionKey {
  agentId: string | null;
  sessionId: string;
  executionId: string | null;
}

export const DEFAULT_COWORK_AGENT_ID = 'main';

const RAW_SESSION_PREFIX = 'justdo:';
const EXECUTION_MARKER = ':execution:';

function normalizeRequiredKeyPart(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes(':')) {
    throw new Error(`${label} must be a non-empty session-key segment.`);
  }
  return normalized;
}

export function buildCoworkSessionKey(
  sessionId: string,
  agentId = DEFAULT_COWORK_AGENT_ID,
): string {
  const normalizedSessionId = sessionId.trim();
  const normalizedAgentId = agentId.trim() || DEFAULT_COWORK_AGENT_ID;
  return `agent:${normalizedAgentId}:justdo:${normalizedSessionId}`;
}

export function buildCoworkExecutionSessionKey(
  sessionId: string,
  executionId: string,
  agentId = DEFAULT_COWORK_AGENT_ID,
): string {
  const canonical = buildCoworkSessionKey(sessionId, agentId);
  const normalizedExecutionId = normalizeRequiredKeyPart(executionId, 'Execution ID');
  return `${canonical}${EXECUTION_MARKER}${normalizedExecutionId}`;
}

function parseSessionAndExecution(
  value: string,
): { sessionId: string; executionId: string | null } | null {
  const executionMarkerIndex = value.lastIndexOf(EXECUTION_MARKER);
  if (executionMarkerIndex < 0) {
    const sessionId = value.trim();
    return sessionId ? { sessionId, executionId: null } : null;
  }
  const sessionId = value.slice(0, executionMarkerIndex).trim();
  const executionId = value.slice(executionMarkerIndex + EXECUTION_MARKER.length).trim();
  if (!sessionId || !executionId || sessionId.includes(':') || executionId.includes(':')) {
    return null;
  }
  return { sessionId, executionId };
}

export function parseCoworkSessionKey(
  sessionKey: string | undefined | null,
): ParsedCoworkSessionKey | null {
  const raw = (sessionKey ?? '').trim();
  if (!raw) return null;

  if (raw.startsWith(RAW_SESSION_PREFIX)) {
    const parsed = parseSessionAndExecution(raw.slice(RAW_SESSION_PREFIX.length));
    return parsed ? { agentId: null, ...parsed } : null;
  }

  const parts = raw.split(':');
  if (parts.length < 4 || parts[0] !== 'agent' || parts[2] !== 'justdo') return null;
  const agentId = parts[1]?.trim();
  if (!agentId) return null;
  const parsed = parseSessionAndExecution(parts.slice(3).join(':'));
  return parsed ? { agentId, ...parsed } : null;
}

export function isCoworkSessionKey(sessionKey: string | undefined | null): boolean {
  return parseCoworkSessionKey(sessionKey) !== null;
}
