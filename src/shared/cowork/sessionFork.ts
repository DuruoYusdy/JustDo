export const CoworkSessionForkIpc = {
  Fork: 'cowork:session:fork',
} as const;

export interface ForkCoworkSessionInput {
  sessionId: string;
  title: string;
  /** Stable entry id of the completed assistant response shown as the branch source. */
  entryId: string;
}
