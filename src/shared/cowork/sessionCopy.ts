export const CoworkSessionCopyIpc = {
  Copy: 'cowork:session:copy',
} as const;

export interface CopyCoworkSessionInput {
  sessionId: string;
  title: string;
}
