import type { BeginCoworkSessionSegmentInput, CoworkSessionSegment } from './sessionSegment';

export const CoworkPlanHandoffState = {
  Presented: 'presented',
  Dispatching: 'dispatching',
  Admitted: 'admitted',
  Resolved: 'resolved',
  Failed: 'failed',
} as const;

export type CoworkPlanHandoffState =
  (typeof CoworkPlanHandoffState)[keyof typeof CoworkPlanHandoffState];

export interface CoworkPlanArtifactReference {
  sessionId: string;
  planId: string;
  workspaceRoot?: string;
  relativePath: string;
  sha256: string;
  byteLength: number;
}

export interface CoworkPlanHandoff {
  planId: string;
  sessionId: string;
  planningSessionKey: string;
  artifact: CoworkPlanArtifactReference;
  state: CoworkPlanHandoffState;
  implementationSessionKey?: string;
  implementationGatewaySessionId?: string;
  implementationRunId?: string;
  error?: string;
  presentedAt: number;
  dispatchStartedAt?: number;
  admittedAt?: number;
  resolvedAt?: number;
  failedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCoworkPlanHandoffInput {
  sessionId: string;
  planId: string;
  planningSessionKey: string;
  artifact: CoworkPlanArtifactReference;
  presentedAt: number;
}

export interface TransitionCoworkPlanHandoffInput {
  planId: string;
  expectedState: CoworkPlanHandoffState;
  nextState: CoworkPlanHandoffState;
  transitionedAt: number;
  implementationSessionKey?: string;
  implementationGatewaySessionId?: string;
  implementationRunId?: string;
  error?: string;
}

export interface AdmitCoworkPlanHandoffInput {
  planId: string;
  expectedState: typeof CoworkPlanHandoffState.Dispatching;
  implementationGatewaySessionId: string;
  implementationRunId: string;
  implementationSegment: BeginCoworkSessionSegmentInput;
  admittedAt: number;
}

export interface AdmittedCoworkPlanHandoff {
  handoff: CoworkPlanHandoff;
  segment: CoworkSessionSegment;
}
