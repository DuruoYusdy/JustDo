export const OpenClawAssistantMediaIpc = {
  ReadDataUrl: 'openclaw:assistantMedia:readDataUrl',
} as const;

export interface OpenClawAssistantMediaRequest {
  /** Canonical media://inbound URI or session-bound managed outgoing image route. */
  source: string;
  /** Session scope used by Gateway authorization and verified against outgoing routes. */
  sessionKey: string;
}

export type OpenClawAssistantMediaResult =
  | { success: true; dataUrl: string; mimeType: string }
  | { success: false; error: string };
