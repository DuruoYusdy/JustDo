export const hasComposerContent = (
  text: string,
  attachmentCount: number,
  annotationCount: number,
  hasRecording: boolean,
  requiresText = false,
): boolean =>
  Boolean(text.trim() || (!requiresText && (attachmentCount || annotationCount || hasRecording)));
