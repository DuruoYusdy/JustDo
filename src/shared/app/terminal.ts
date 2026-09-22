export const TerminalIpc = {
  Create: 'terminal:create',
  Write: 'terminal:write',
  Resize: 'terminal:resize',
  Close: 'terminal:close',
  Data: 'terminal:data',
  Exit: 'terminal:exit',
} as const;

export interface TerminalCreateRequest {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalCreateResult {
  success: boolean;
  cwd?: string;
  error?: string;
}

export interface TerminalWriteRequest {
  id: string;
  data: string;
}

export interface TerminalResizeRequest {
  id: string;
  cols: number;
  rows: number;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number;
}

export interface TerminalActionResult {
  success: boolean;
  error?: string;
}
