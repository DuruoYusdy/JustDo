/** Cancel initial admission before the Renderer knows its canonical session ID. */
export const SessionStartIpc = { Cancel: 'cowork:session:start:cancel' } as const;

export interface CancelSessionStartInput {
  clientTurnId: string;
}

export interface CancelSessionStartResult {
  success: boolean;
  error?: string;
}
