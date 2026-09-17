import { matchesShortcut, type ShortcutInput } from './shortcuts';

export const BrowserIpc = {
  GetStatus: 'browser:getStatus',
  CanSetMode: 'browser:canSetMode',
  SetMode: 'browser:setMode',
  OpenRemoteDebugging: 'browser:openRemoteDebugging',
  TestConnection: 'browser:testConnection',
  OpenExtensionManagement: 'browser:openExtensionManagement',
  RevealExtension: 'browser:revealExtension',
  CopyExtensionPairing: 'browser:copyExtensionPairing',
  TestExtensionConnection: 'browser:testExtensionConnection',
  CreateLocalHtmlPreview: 'browser:createLocalHtmlPreview',
  PanelOpenTab: 'browser:panelOpenTab',
  PanelSetShortcuts: 'browser:panelSetShortcuts',
  PanelShortcutAction: 'browser:panelShortcutAction',
  ListImportSources: 'browser:listImportSources',
  ImportData: 'browser:importData',
  ListHistory: 'browser:listHistory',
  DeleteHistory: 'browser:deleteHistory',
  ClearHistory: 'browser:clearHistory',
  ListDownloads: 'browser:listDownloads',
  DeleteDownloads: 'browser:deleteDownloads',
  ClearDownloads: 'browser:clearDownloads',
  OpenDownload: 'browser:openDownload',
  RevealDownload: 'browser:revealDownload',
  GetClearDataSummary: 'browser:getClearDataSummary',
  ClearBrowsingData: 'browser:clearBrowsingData',
} as const;

export type BrowserPanelShortcutAction = 'terminal' | 'browser' | 'side-chat';

export type BrowserPanelShortcutSettings = Record<BrowserPanelShortcutAction, string>;

export const DEFAULT_BROWSER_PANEL_SHORTCUTS: BrowserPanelShortcutSettings = {
  terminal: 'Ctrl+`',
  browser: 'Ctrl+T',
  'side-chat': 'Ctrl+Alt+S',
};

export const normalizeBrowserPanelShortcutSettings = (
  value: unknown,
): BrowserPanelShortcutSettings | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.terminal !== 'string' ||
    typeof record.browser !== 'string' ||
    typeof record['side-chat'] !== 'string'
  )
    return null;
  return {
    terminal: record.terminal.slice(0, 80),
    browser: record.browser.slice(0, 80),
    'side-chat': record['side-chat'].slice(0, 80),
  };
};

export const resolveBrowserPanelShortcutAction = (
  input: ShortcutInput,
  shortcuts: BrowserPanelShortcutSettings,
): BrowserPanelShortcutAction | null => {
  if (matchesShortcut(input, shortcuts.terminal)) return 'terminal';
  if (matchesShortcut(input, shortcuts.browser)) return 'browser';
  if (matchesShortcut(input, shortcuts['side-chat'])) return 'side-chat';
  return null;
};

export type BrowserLocalHtmlPreviewResult =
  | {
      success: true;
      url: string;
      filePath: string;
      rootPath: string;
      previewRootUrl: string;
    }
  | {
      success: false;
      errorCode: 'invalid_request' | 'not_found' | 'invalid_type' | 'invalid_source' | 'failed';
    };

export const BROWSER_GUEST_COMMAND_CHANNEL = 'justdo-browser-command';
export const BROWSER_GUEST_CREDENTIALS_GET_CHANNEL = 'justdo-browser-credentials:get';
export const BROWSER_GUEST_CREDENTIALS_OFFER_CHANNEL = 'justdo-browser-credentials:offer';
export const BROWSER_GUEST_CREDENTIALS_FILL_CHANNEL = 'justdo-browser-credentials:fill';
export const BROWSER_PANEL_PARTITION = 'persist:justdo-browser';
export const BROWSER_ANNOTATION_CONTEXT_MAX_LENGTH = 8_000;

export type BrowserPanelOpenTabEvent = {
  url: string;
  errorCode?: 'post-navigation-blocked';
};

export const normalizeBrowserPanelOpenTabEvent = (
  value: unknown,
): BrowserPanelOpenTabEvent | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== 'string') return null;
  return {
    url: record.url,
    ...(record.errorCode === 'post-navigation-blocked'
      ? { errorCode: 'post-navigation-blocked' as const }
      : {}),
  };
};

export const BrowserGuestCommands = [
  'focus-address',
  'new-tab',
  'reopen-tab',
  'close-tab',
  'reload',
  'back',
  'forward',
  'next-tab',
  'previous-tab',
] as const;

export type BrowserGuestCommand = (typeof BrowserGuestCommands)[number];

export const isBrowserGuestCommand = (value: unknown): value is BrowserGuestCommand =>
  typeof value === 'string' && BrowserGuestCommands.some(command => command === value);

type BrowserShortcutInput = {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

export const resolveBrowserGuestShortcut = (
  input: BrowserShortcutInput,
): BrowserGuestCommand | null => {
  if (input.type !== 'keyDown') return null;
  const key = input.key.toLowerCase();
  const primary = input.control || input.meta;
  if (primary && !input.alt) {
    if (key === 'l') return 'focus-address';
    if (key === 't' && input.shift) return 'reopen-tab';
    if (key === 'w') return 'close-tab';
    if (key === 'r') return 'reload';
    if (key === 'tab') return input.shift ? 'previous-tab' : 'next-tab';
  }
  if (!primary && input.alt && !input.shift) {
    if (key === 'arrowleft') return 'back';
    if (key === 'arrowright') return 'forward';
  }
  if (!primary && !input.alt && !input.shift && key === 'f5') return 'reload';
  return null;
};

export const BrowserMode = {
  Isolated: 'isolated',
  User: 'user',
  Extension: 'extension',
} as const;

export type BrowserMode = (typeof BrowserMode)[keyof typeof BrowserMode];

export const normalizeBrowserMode = (value: unknown): BrowserMode =>
  value === BrowserMode.User || value === BrowserMode.Extension ? value : BrowserMode.Isolated;

export const BrowserSearchEngine = {
  Baidu: 'baidu',
  Google: 'google',
} as const;

export type BrowserSearchEngine = (typeof BrowserSearchEngine)[keyof typeof BrowserSearchEngine];

export const normalizeBrowserSearchEngine = (value: unknown): BrowserSearchEngine =>
  value === BrowserSearchEngine.Google ? BrowserSearchEngine.Google : BrowserSearchEngine.Baidu;

export type BrowserDownloadSettings = {
  directory: string;
  askWhereToSave: boolean;
};

export const normalizeBrowserDownloadSettings = (value: {
  directory?: unknown;
  askWhereToSave?: unknown;
}): BrowserDownloadSettings => ({
  directory: typeof value.directory === 'string' ? value.directory.trim().slice(0, 4_096) : '',
  // Preserve the app's existing behavior for users who do not have this setting yet.
  askWhereToSave: typeof value.askWhereToSave === 'boolean' ? value.askWhereToSave : true,
});

const buildBrowserSearchUrl = (query: string, searchEngine: BrowserSearchEngine): string => {
  const url = new URL(
    searchEngine === BrowserSearchEngine.Google
      ? 'https://www.google.com/search'
      : 'https://www.baidu.com/s',
  );
  url.searchParams.set(searchEngine === BrowserSearchEngine.Google ? 'q' : 'wd', query);
  return url.toString();
};

/** Resolves omnibox input to a safe web URL, falling back to the selected search engine. */
export const resolveBrowserAddressInput = (
  raw: string,
  searchEngine: BrowserSearchEngine,
): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === 'about:blank') return trimmed;

  const explicitWebScheme = /^https?:\/\//i.test(trimmed);
  const hasAnyScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed);
  if (explicitWebScheme) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    } catch {
      // Invalid explicit URLs are searched as text, matching browser omnibox behavior.
    }
    return buildBrowserSearchUrl(trimmed, searchEngine);
  }

  if (!hasAnyScheme && !/\s/.test(trimmed)) {
    try {
      const parsed = new URL(`https://${trimmed}`);
      const hostname = parsed.hostname.toLowerCase();
      const likelyWebHost =
        hostname === 'localhost' ||
        hostname.includes('.') ||
        hostname.includes(':') ||
        /:\d+(?:[/?#]|$)/.test(trimmed);
      if (likelyWebHost) return parsed.toString();
    } catch {
      // Non-URL input is handled as a search query below.
    }
  }

  return buildBrowserSearchUrl(trimmed, searchEngine);
};

export type BrowserConnectionIssue =
  | 'unsupported-platform'
  | 'chrome-not-found'
  | 'remote-debugging-disabled'
  | 'port-occupied-by-other-process'
  | 'chrome-restart-required'
  | 'not-running';

export type BrowserPortOwner = {
  pid: number;
  processName: string | null;
  isChrome: boolean;
};

export type BrowserConnectionStatus = {
  supported: boolean;
  chromeFound: boolean;
  remoteDebuggingEnabled: boolean;
  activePort: number | null;
  activePortFileExists: boolean;
  activePortOwnerResolved: boolean;
  activePortOwner: BrowserPortOwner | null;
  endpointReachable: boolean;
  issue: BrowserConnectionIssue | null;
};

export type BrowserStatusResult = {
  success: boolean;
  status?: BrowserConnectionStatus;
  error?: string;
};

export type BrowserActionResult = {
  success: boolean;
  error?: string;
};

export type BrowserImportSource = {
  id: string;
  browser: 'chrome';
  name: string;
};

export type BrowserImportSourcesResult = BrowserActionResult & {
  sources?: BrowserImportSource[];
};

export type BrowserImportRequest = {
  sourceId: string;
  passwords: boolean;
  cookies: boolean;
  history: boolean;
  approved: boolean;
};

export type BrowserImportResult = BrowserActionResult & {
  imported?: { passwords: number; cookies: number; history: number };
  skippedAppBound?: { passwords: number; cookies: number };
  errorCode?: 'invalid-request' | 'source-unavailable' | 'chrome-running' | 'decrypt-failed';
};

export type BrowserImportedCredential = { username: string; password: string };

export type BrowserHistoryEntry = {
  url: string;
  title: string;
  lastVisitAt: number;
  visitCount: number;
};

export type BrowserHistoryListResult = BrowserActionResult & {
  entries?: BrowserHistoryEntry[];
};

export type BrowserDownloadState =
  'queued' | 'progressing' | 'completed' | 'cancelled' | 'interrupted';

export type BrowserDownloadEntry = {
  id: string;
  fileName: string;
  sourceUrl: string;
  state: BrowserDownloadState;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
  updatedAt: number;
};

export type BrowserDownloadListResult = BrowserActionResult & {
  entries?: BrowserDownloadEntry[];
};

export const BrowserClearDataRanges = ['hour', 'day', 'week', 'four-weeks', 'all'] as const;
export type BrowserClearDataRange = (typeof BrowserClearDataRanges)[number];

export type BrowserClearDataSelection = {
  history: boolean;
  cookiesAndSiteData: boolean;
  cache: boolean;
  downloads: boolean;
  autofill: boolean;
};

export type BrowserClearDataRequest = {
  range: BrowserClearDataRange;
  selection: BrowserClearDataSelection;
};

export type BrowserClearDataSummary = {
  history: number;
  latestHistoryOrigin: string;
  cookieSites: number;
  downloads: number;
  autofill: number;
};

export type BrowserClearDataSummaryResult = BrowserActionResult & {
  summary?: BrowserClearDataSummary;
};

export type BrowserClearDataResult = BrowserActionResult & {
  cleared?: BrowserClearDataSummary;
  failedCategories?: Array<keyof BrowserClearDataSelection>;
  errorCode?: 'invalid-request' | 'clear-failed';
};

export const isBrowserClearDataRange = (value: unknown): value is BrowserClearDataRange =>
  typeof value === 'string' && BrowserClearDataRanges.some(range => range === value);

export type BrowserModeUpdateResult = BrowserActionResult & {
  mode?: BrowserMode;
  errorCode?: 'invalid-mode' | 'active-session' | 'config-sync-failed';
};

export type BrowserModeSwitchAvailabilityResult = BrowserActionResult & {
  canSwitch: boolean;
  errorCode?: 'active-session';
};

export type BrowserConnectionTestResult = BrowserActionResult & {
  errorCode?:
    | 'gateway-unavailable'
    | 'permission-timeout'
    | 'extension-not-connected'
    | 'browser-not-running'
    | 'connection-failed';
};

export type BrowserPanelTab = {
  id: string;
  targetId: string;
  title: string;
  customTitle?: string;
  faviconUrl?: string;
  muted?: boolean;
  url: string;
  sourceFilePath?: string;
  sourcePreviewUrl?: string;
  sourceRootPath?: string;
  sourcePreviewRootUrl?: string;
  urlUnavailableReason?: 'navigation_blocked' | 'navigation_check_failed';
};

export type BrowserPanelTabs = {
  running: boolean;
  profile: 'openclaw' | 'user' | 'chrome' | 'embedded';
  tabs: BrowserPanelTab[];
};

export type BrowserPanelFrame = {
  targetId: string;
  url: string;
  title: string;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  capturedAt: number;
  dataUrl: string;
};

export type BrowserPanelRect = { x: number; y: number; width: number; height: number };

export type BrowserInspectedElement = {
  tag: string;
  id: string;
  classes: string[];
  role: string;
  name: string;
  rect: BrowserPanelRect;
  focusable: boolean;
  cssPath: string;
  computedStyle?: BrowserInspectedElementStyle;
};

export type BrowserInspectedElementStyle = {
  color: string;
  backgroundColor: string;
  opacity: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  display: string;
  position: string;
  zIndex: string;
  borderRadius: string;
};

export type BrowserAnnotationPoint = { x: number; y: number };
export type BrowserAnnotationStroke = { points: BrowserAnnotationPoint[] };
export type BrowserAnnotationRegion = BrowserPanelRect & {
  elements?: BrowserInspectedElement[];
};

export type BrowserAnnotationElementSummary = {
  tag: string;
  id: string;
  classes: string[];
  role: string;
  name: string;
  cssPath: string;
  rect: BrowserPanelRect;
};

export type BrowserAnnotationDisplay = {
  id: string;
  title: string;
  displayUrl: string;
  markedRegionCount: number;
  element?: BrowserAnnotationElementSummary;
};

export type BrowserAnnotationDraft = {
  id: string;
  modelContext: string;
  title: string;
  displayUrl: string;
  markedRegionCount: number;
  inspectedElement: boolean;
  display?: BrowserAnnotationDisplay;
  dataUrl: string;
  fileName: string;
  addedAt: number;
};

const BROWSER_CONTEXT_START = '<justdo-browser-context-v1>';
const BROWSER_CONTEXT_END = '</justdo-browser-context-v1>';
const BROWSER_CONTEXT_LENGTH_PREFIX = 'content-length:';
const BROWSER_DISPLAY_LENGTH_PREFIX = 'display-metadata-length:';

export type ParsedBrowserAnnotationPrompt = {
  userText: string;
  annotations: BrowserAnnotationDisplay[];
};

const boundedDisplayString = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';

const parseDisplayRect = (value: unknown): BrowserPanelRect | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const values = [record.x, record.y, record.width, record.height];
  if (!values.every(item => typeof item === 'number' && Number.isFinite(item))) return null;
  return {
    x: Math.max(-100_000, Math.min(100_000, record.x as number)),
    y: Math.max(-100_000, Math.min(100_000, record.y as number)),
    width: Math.max(0, Math.min(100_000, record.width as number)),
    height: Math.max(0, Math.min(100_000, record.height as number)),
  };
};

const parseDisplayAnnotations = (value: string): BrowserAnnotationDisplay[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 4).flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const elementRecord =
        record.element && typeof record.element === 'object' && !Array.isArray(record.element)
          ? (record.element as Record<string, unknown>)
          : null;
      const rect = elementRecord ? parseDisplayRect(elementRecord.rect) : null;
      const element =
        elementRecord && rect
          ? {
              tag: boundedDisplayString(elementRecord.tag, 40).toLowerCase(),
              id: boundedDisplayString(elementRecord.id, 80),
              classes: Array.isArray(elementRecord.classes)
                ? elementRecord.classes
                    .slice(0, 3)
                    .map(item => boundedDisplayString(item, 60))
                    .filter(Boolean)
                : [],
              role: boundedDisplayString(elementRecord.role, 40),
              name: boundedDisplayString(elementRecord.name, 160),
              cssPath: boundedDisplayString(elementRecord.cssPath, 400),
              rect,
            }
          : undefined;
      return [
        {
          id: boundedDisplayString(record.id, 80),
          title: boundedDisplayString(record.title, 120),
          displayUrl: boundedDisplayString(record.displayUrl, 300),
          markedRegionCount:
            typeof record.markedRegionCount === 'number' &&
            Number.isFinite(record.markedRegionCount)
              ? Math.max(0, Math.min(8, Math.floor(record.markedRegionCount)))
              : 0,
          ...(element?.tag ? { element } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
};

export function serializeBrowserAnnotationContext(
  annotations: readonly BrowserAnnotationDraft[],
): string {
  const displayMetadata = JSON.stringify(
    annotations.map(annotation => ({
      id: annotation.display?.id ?? annotation.id,
      title: annotation.display?.title ?? annotation.title,
      displayUrl: annotation.display?.displayUrl ?? annotation.displayUrl,
      markedRegionCount: annotation.display?.markedRegionCount ?? annotation.markedRegionCount,
      ...(annotation.display?.element ? { element: annotation.display.element } : {}),
    })),
  );
  return `${BROWSER_DISPLAY_LENGTH_PREFIX}${displayMetadata.length}\n${displayMetadata}\n${annotations
    .map(annotation => annotation.modelContext)
    .join('\n\n')}`;
}

export function composeBrowserGatewayPrompt(
  userText: string,
  annotations: readonly BrowserAnnotationDraft[],
): string {
  if (!annotations.length) return userText;
  const context = serializeBrowserAnnotationContext(annotations);
  if (context.length > BROWSER_ANNOTATION_CONTEXT_MAX_LENGTH) {
    throw new RangeError('Browser annotation context exceeds the supported length.');
  }
  return `${BROWSER_CONTEXT_START}\n${BROWSER_CONTEXT_LENGTH_PREFIX}${context.length}\n${context}\n${BROWSER_CONTEXT_END}\n\n${userText}`;
}

export function parseBrowserAnnotationPrompt(value: string): ParsedBrowserAnnotationPrompt | null {
  const start = `${BROWSER_CONTEXT_START}\n`;
  if (!value.startsWith(start)) return null;
  const contentStart = start.length;
  if (value.startsWith(BROWSER_CONTEXT_LENGTH_PREFIX, contentStart)) {
    const headerEnd = value.indexOf('\n', contentStart);
    if (headerEnd < 0) return null;
    const lengthText = value.slice(contentStart + BROWSER_CONTEXT_LENGTH_PREFIX.length, headerEnd);
    if (!/^\d+$/.test(lengthText)) return null;
    const contextLength = Number(lengthText);
    if (!Number.isSafeInteger(contextLength)) return null;
    const end = headerEnd + 1 + contextLength;
    const boundary = `\n${BROWSER_CONTEXT_END}`;
    if (value.slice(end, end + boundary.length) !== boundary) return null;
    const userTextStart = end + boundary.length;
    if (value.slice(userTextStart, userTextStart + 2) !== '\n\n') return null;
    const context = value.slice(headerEnd + 1, end);
    let annotations: BrowserAnnotationDisplay[] = [];
    if (context.startsWith(BROWSER_DISPLAY_LENGTH_PREFIX)) {
      const metadataHeaderEnd = context.indexOf('\n');
      const metadataLengthText = context.slice(
        BROWSER_DISPLAY_LENGTH_PREFIX.length,
        metadataHeaderEnd,
      );
      if (metadataHeaderEnd >= 0 && /^\d+$/.test(metadataLengthText)) {
        const metadataLength = Number(metadataLengthText);
        const metadataStart = metadataHeaderEnd + 1;
        if (
          Number.isSafeInteger(metadataLength) &&
          metadataLength >= 0 &&
          metadataLength <= 16_000 &&
          context.length >= metadataStart + metadataLength
        ) {
          annotations = parseDisplayAnnotations(
            context.slice(metadataStart, metadataStart + metadataLength),
          );
        }
      }
    }
    return { userText: value.slice(userTextStart + 2), annotations };
  }

  // Compatibility with prompts produced before the length-delimited envelope.
  const legacyEnd = value.indexOf(`\n${BROWSER_CONTEXT_END}`, contentStart);
  if (legacyEnd < 0) return null;
  return {
    userText: value.slice(legacyEnd + BROWSER_CONTEXT_END.length + 1).replace(/^\s+/, ''),
    annotations: [],
  };
}

export function extractBrowserAnnotationUserText(value: string): string | null {
  return parseBrowserAnnotationPrompt(value)?.userText ?? null;
}

export const isBrowserProfileRunning = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  return (value as { running?: unknown }).running === true;
};

export const parseDevToolsActivePort = (content: string): number | null => {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const port = Number(firstLine);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
};
