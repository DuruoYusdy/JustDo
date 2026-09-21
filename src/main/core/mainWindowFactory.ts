import { randomUUID } from 'crypto';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  session,
  shell,
} from 'electron';
import fs from 'fs';
import path from 'path';

import {
  BROWSER_GUEST_COMMAND_CHANNEL,
  BROWSER_IMPORTED_PROFILE_PARTITION,
  BROWSER_PANEL_PARTITION,
  type BrowserDownloadSettings,
  BrowserIpc,
  browserProfileFromPartition,
  DEFAULT_BROWSER_PANEL_SHORTCUTS,
  normalizeBrowserPanelShortcutSettings,
  resolveBrowserGuestShortcut,
  resolveBrowserPanelShortcutAction,
} from '../../shared/browser';
import { MediaCaptureIpc } from '../../shared/mediaCapture';
import {
  cancelAllBrowserAgentDownloads,
  claimBrowserAgentDownload,
} from '../browser/browserAgentDownloadCoordinator';
import {
  recordBrowserDownload,
  recordBrowserHistory,
  updateBrowserDownload,
} from '../browser/browserDataImportService';
import { sanitizeBrowserUrl } from '../browser/browserDataSanitizers';
import {
  resolveAvailableBrowserDownloadPath,
  resolveBrowserDownloadDirectory,
} from '../browser/browserDownloadPath';
import {
  isAllowedLocalHtmlPreviewResource,
  isLocalHtmlPreviewUrl,
  isSameLocalHtmlPreviewScope,
} from '../browser/localHtmlPreviewServer';
import {
  isAllowedBrowserPanelUrl,
  isAllowedMainWindowNavigation,
  isBlockedBrowserMetadataHost,
} from './browserPanelSecurity';
import {
  shouldAllowAudioMediaCheck,
  shouldAllowAudioMediaRequest,
  shouldAllowSystemAudioCapture,
} from './mediaPermission';
import { registerBrowserProxySession } from './systemProxyPreference';

type MainWindowFactoryOptions = {
  appName: string;
  browserGuestPreloadPath: string;
  devServerUrl: string;
  getBackgroundColor: () => string;
  getIconPath: () => string | undefined;
  getBrowserDownloadSettings: () => BrowserDownloadSettings;
  getProxyCredentials: () => {
    host: string;
    password: string;
    port: number;
    username: string;
  } | null;
  getTitleBarOverlay: () => Electron.TitleBarOverlay;
  isDev: boolean;
  isMac: boolean;
  isQuitting: () => boolean;
  isWindows: boolean;
  onDidFinishLoad: (window: BrowserWindow) => void;
  onReadyToShow: (window: BrowserWindow) => void;
  onWindowStateChanged: (window: BrowserWindow) => void;
  preloadPath: string;
  scheduleReload: (reason: string) => void;
};

const DEV_LOAD_MAX_RETRIES = 3;
const LOAD_RETRY_DELAY_MS = 3_000;
const LOAD_TIMEOUT_MS = 30_000;
const CHAT_TIMELINE_TRACE_PREFIX = '[ChatTimelineTrace] ';
const CHAT_TIMELINE_TRACE_MAX_BYTES = 64 * 1024;
const SYSTEM_AUDIO_CAPTURE_AUTHORIZATION_TTL_MS = 5_000;

export const createMainWindow = (options: MainWindowFactoryOptions): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: options.appName,
    icon: options.getIconPath(),
    ...(options.isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 12, y: 20 },
        }
      : options.isWindows
        ? {
            frame: false,
            titleBarStyle: 'hidden' as const,
          }
        : {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: options.getTitleBarOverlay(),
          }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
      preload: options.preloadPath,
      backgroundThrottling: false,
      devTools: options.isDev,
      spellcheck: false,
      enableWebSQL: false,
      autoplayPolicy: 'document-user-activation-required',
      disableDialogs: true,
      navigateOnDragDrop: false,
    },
    backgroundColor: options.getBackgroundColor(),
    show: false,
    autoHideMenuBar: true,
    enableLargerThanScreen: false,
  });

  if (options.isMac && options.isDev) {
    const iconPath = path.join(__dirname, '../resources/icons/png/512x512.png');
    if (fs.existsSync(iconPath)) {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }
  }

  mainWindow.setMenu(null);
  mainWindow.setMinimumSize(800, 600);
  let systemAudioCaptureAuthorizedUntil = 0;
  ipcMain.removeHandler(MediaCaptureIpc.ArmSystemAudio);
  ipcMain.handle(MediaCaptureIpc.ArmSystemAudio, event => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    ) {
      throw new Error('System audio capture can only be armed by the main application frame.');
    }
    systemAudioCaptureAuthorizedUntil = Date.now() + SYSTEM_AUDIO_CAPTURE_AUTHORIZATION_TTL_MS;
  });
  mainWindow.once('closed', () => {
    ipcMain.removeHandler(MediaCaptureIpc.ArmSystemAudio);
    systemAudioCaptureAuthorizedUntil = 0;
  });
  const windowSession = mainWindow.webContents.session;
  const browserPanelSession = session.fromPartition(BROWSER_PANEL_PARTITION);
  const importedBrowserSession = session.fromPartition(BROWSER_IMPORTED_PROFILE_PARTITION);
  const browserPanelSessions = new Map<string, Electron.Session>([
    [BROWSER_PANEL_PARTITION, browserPanelSession],
    [BROWSER_IMPORTED_PROFILE_PARTITION, importedBrowserSession],
  ]);
  const localPreviewScopesByGuestId = new Map<number, string>();
  let browserPanelShortcuts = DEFAULT_BROWSER_PANEL_SHORTCUTS;
  const handleBrowserPanelShortcuts = (event: Electron.IpcMainEvent, value: unknown) => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      return;
    const normalized = normalizeBrowserPanelShortcutSettings(value);
    if (normalized) browserPanelShortcuts = normalized;
  };
  ipcMain.on(BrowserIpc.PanelSetShortcuts, handleBrowserPanelShortcuts);
  mainWindow.once('closed', () => {
    ipcMain.off(BrowserIpc.PanelSetShortcuts, handleBrowserPanelShortcuts);
  });
  for (const browserSession of browserPanelSessions.values()) {
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
  }
  windowSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    if (webContents !== mainWindow.webContents) return false;
    if (permission !== 'media') return true;
    return shouldAllowAudioMediaCheck(true, details);
  });
  windowSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (webContents !== mainWindow.webContents) {
      callback(false);
      return;
    }
    if (permission !== 'media') {
      callback(true);
      return;
    }
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    const allowed = shouldAllowAudioMediaRequest(true, mediaTypes);
    callback(allowed);
  });
  windowSession.setDisplayMediaRequestHandler((request, callback) => {
    const isMainFrame = request.frame === mainWindow.webContents.mainFrame;
    const authorizedByRenderer = isMainFrame && Date.now() <= systemAudioCaptureAuthorizedUntil;
    if (isMainFrame) systemAudioCaptureAuthorizedUntil = 0;
    const allowed = shouldAllowSystemAudioCapture({
      audioRequested: request.audioRequested,
      authorizedByRenderer,
      isMainFrame,
      videoRequested: request.videoRequested,
      isWindows: process.platform === 'win32',
    });
    if (!allowed) {
      callback({});
      return;
    }
    void desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(sources => {
        const primarySource = sources[0];
        if (!primarySource || mainWindow.isDestroyed()) {
          console.warn('[SystemAudioCapture] No usable desktop source is available.');
          callback({});
          return;
        }
        callback({ video: primarySource, audio: 'loopback' });
      })
      .catch(error => {
        console.warn(
          '[SystemAudioCapture] Failed to enumerate desktop sources:',
          error instanceof Error ? error.message : String(error),
        );
        callback({});
      });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedBrowserPanelUrl(url) && url !== 'about:blank') void shell.openExternal(url);
    return { action: 'deny' };
  });
  const mainNavigationOptions = {
    appRoot: path.resolve(__dirname, '..'),
    devServerUrl: options.devServerUrl,
    isDev: options.isDev,
  };
  mainWindow.webContents.on('will-navigate', event => {
    if (!isAllowedMainWindowNavigation(event.url, mainNavigationOptions)) event.preventDefault();
  });
  mainWindow.webContents.on('will-frame-navigate', event => {
    if (event.isMainFrame && !isAllowedMainWindowNavigation(event.url, mainNavigationOptions)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.preload = options.browserGuestPreloadPath;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.webviewTag = false;
    webPreferences.spellcheck = true;
    // The Agent dialog action observes and resolves dialogs through the exact
    // guest WebContents debugger. Keep browser-page dialogs enabled while the
    // application renderer itself remains protected above.
    webPreferences.disableDialogs = false;
    webPreferences.navigateOnDragDrop = false;

    if (!browserProfileFromPartition(params.partition) || !isAllowedBrowserPanelUrl(params.src)) {
      event.preventDefault();
      return;
    }
    if (!browserPanelSessions.has(params.partition)) {
      const browserSession = session.fromPartition(params.partition);
      browserPanelSessions.set(params.partition, browserSession);
      void registerBrowserProxySession(browserSession);
      browserSession.setPermissionCheckHandler(() => false);
      browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
      });
      installBrowserRequestGuard(browserSession);
      browserSession.on('will-download', handleBrowserDownload);
    }
  });
  mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    let localPreviewScopeUrl = isLocalHtmlPreviewUrl(guestContents.getURL())
      ? guestContents.getURL()
      : null;
    const bindLocalPreviewScope = (url: string): void => {
      if (localPreviewScopeUrl || !isLocalHtmlPreviewUrl(url)) return;
      localPreviewScopeUrl = url;
      localPreviewScopesByGuestId.set(guestContents.id, url);
    };
    if (localPreviewScopeUrl) {
      localPreviewScopesByGuestId.set(guestContents.id, localPreviewScopeUrl);
    }
    const canNavigateWithinPreviewScope = (url: string): boolean => {
      return !localPreviewScopeUrl || isSameLocalHtmlPreviewScope(localPreviewScopeUrl, url);
    };
    guestContents.setWindowOpenHandler(details => {
      const { url } = details;
      if (!canNavigateWithinPreviewScope(url)) return { action: 'deny' };
      if (details.postBody) {
        mainWindow.webContents.send(BrowserIpc.PanelOpenTab, {
          url,
          openerGuestId: guestContents.id,
          errorCode: 'post-navigation-blocked',
        });
        return { action: 'deny' };
      }
      if (isAllowedBrowserPanelUrl(url)) {
        mainWindow.webContents.send(BrowserIpc.PanelOpenTab, {
          url: url || 'about:blank',
          openerGuestId: guestContents.id,
        });
      }
      return { action: 'deny' };
    });
    guestContents.on('before-input-event', (event, input) => {
      const shortcutAction =
        input.type === 'keyDown' && !input.isAutoRepeat
          ? resolveBrowserPanelShortcutAction(
              {
                key: input.key,
                altKey: input.alt,
                ctrlKey: input.control,
                shiftKey: input.shift,
                metaKey: input.meta,
              },
              browserPanelShortcuts,
            )
          : null;
      if (shortcutAction) {
        event.preventDefault();
        mainWindow.webContents.send(BrowserIpc.PanelShortcutAction, shortcutAction);
        return;
      }
      const command = resolveBrowserGuestShortcut(input);
      if (!command) return;
      event.preventDefault();
      guestContents.send(BROWSER_GUEST_COMMAND_CHANNEL, command);
    });
    guestContents.on('will-navigate', (event, url) => {
      bindLocalPreviewScope(url);
      if (!isAllowedBrowserPanelUrl(url) || !canNavigateWithinPreviewScope(url)) {
        event.preventDefault();
      }
    });
    guestContents.on('will-frame-navigate', event => {
      if (event.isMainFrame) bindLocalPreviewScope(event.url);
      if (!isAllowedBrowserPanelUrl(event.url) || !canNavigateWithinPreviewScope(event.url)) {
        event.preventDefault();
      }
    });
    guestContents.on('will-redirect', (event, url) => {
      if (!isAllowedBrowserPanelUrl(url) || !canNavigateWithinPreviewScope(url)) {
        event.preventDefault();
      }
    });
    guestContents.on('did-stop-loading', () => {
      const url = guestContents.getURL();
      if (!localPreviewScopeUrl) recordBrowserHistory(url, guestContents.getTitle());
    });
    guestContents.once('destroyed', () => {
      localPreviewScopesByGuestId.delete(guestContents.id);
    });
    guestContents.on('login', (event, _details, authInfo, callback) => {
      const credentials = options.getProxyCredentials();
      const matchesConfiguredProxy =
        authInfo.isProxy &&
        credentials &&
        authInfo.host.toLowerCase() === credentials.host.toLowerCase() &&
        authInfo.port === credentials.port;
      if (!matchesConfiguredProxy) {
        callback();
        return;
      }
      event.preventDefault();
      callback(credentials.username, credentials.password);
    });
  });
  const installBrowserRequestGuard = (browserSession: Electron.Session) =>
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const localPreviewScopeUrl = localPreviewScopesByGuestId.get(details.webContentsId);
      const blockPreviewRequest = Boolean(
        localPreviewScopeUrl &&
        !isAllowedLocalHtmlPreviewResource(localPreviewScopeUrl, details.url),
      );
      const isMainFrame = details.resourceType === 'mainFrame';
      const blockGuestMainFrame = isMainFrame && !isAllowedBrowserPanelUrl(details.url);
      if (blockPreviewRequest || blockGuestMainFrame) {
        callback({ cancel: true });
        return;
      }
      let requestUrl: URL;
      try {
        requestUrl = new URL(details.url);
      } catch {
        callback(isMainFrame ? { cancel: true } : {});
        return;
      }
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(requestUrl.protocol)) {
        callback({});
        return;
      }
      const hostname = requestUrl.hostname;
      if (!hostname || isBlockedBrowserMetadataHost(hostname)) {
        callback({ cancel: true });
        return;
      }
      // Resolve through this exact partition so Chromium's subsequent connection
      // shares the same host-resolver cache entry instead of racing a separate
      // default-session lookup.
      void browserSession
        .resolveHost(hostname)
        .then(result => {
          const addresses = result.endpoints.map(endpoint => endpoint.address);
          const allowRequest =
            addresses.length > 0 &&
            addresses.every(address => !isBlockedBrowserMetadataHost(address));
          callback(allowRequest ? {} : { cancel: true });
        })
        .catch(() => callback({ cancel: true }));
    });
  browserPanelSessions.forEach(installBrowserRequestGuard);
  const pendingDownloads = new Set<Electron.DownloadItem>();
  const reservedDownloadPaths = new Set<string>();
  const downloadDefaultDirectories = new WeakMap<Electron.DownloadItem, string>();
  const downloadIds = new WeakMap<Electron.DownloadItem, string>();
  const downloadUpdateTimers = new Map<Electron.DownloadItem, NodeJS.Timeout>();
  const pendingDownloadStates = new WeakMap<Electron.DownloadItem, 'progressing' | 'interrupted'>();
  const persistDownloadUpdate = (
    item: Electron.DownloadItem,
    state: 'queued' | 'progressing' | 'completed' | 'cancelled' | 'interrupted',
    savePath?: string,
  ): void => {
    const id = downloadIds.get(item);
    if (!id) return;
    try {
      updateBrowserDownload(id, {
        state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        savePath,
      });
    } catch (error) {
      console.warn(
        '[BrowserPanel] Failed to persist download state:',
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const scheduleDownloadUpdate = (
    item: Electron.DownloadItem,
    state: 'progressing' | 'interrupted',
  ): void => {
    pendingDownloadStates.set(item, state);
    if (downloadUpdateTimers.has(item)) return;
    const timer = setTimeout(() => {
      downloadUpdateTimers.delete(item);
      persistDownloadUpdate(item, pendingDownloadStates.get(item) ?? 'progressing');
    }, 300);
    timer.unref();
    downloadUpdateTimers.set(item, timer);
  };
  let downloadConfirmationQueue = Promise.resolve();
  const confirmBrowserDownload = async (item: Electron.DownloadItem): Promise<void> => {
    if (!pendingDownloads.has(item) || mainWindow.isDestroyed()) return;
    const suggestedName = path.basename(item.getFilename()) || 'download';
    const defaultDirectory = downloadDefaultDirectories.get(item) ?? app.getPath('downloads');
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: path.join(defaultDirectory, suggestedName),
      });
      if (
        result.canceled ||
        !result.filePath ||
        mainWindow.isDestroyed() ||
        item.getState() !== 'progressing'
      ) {
        item.cancel();
        return;
      }
      item.setSavePath(result.filePath);
      persistDownloadUpdate(item, 'progressing', result.filePath);
      item.resume();
    } catch (error) {
      item.cancel();
      console.warn(
        '[BrowserPanel] Failed to choose a download destination:',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      pendingDownloads.delete(item);
    }
  };
  const handleBrowserDownload = (
    _event: Electron.Event,
    item: Electron.DownloadItem,
    originWebContents?: Electron.WebContents,
  ): void => {
    const id = randomUUID();
    const now = Date.now();
    const settings = options.getBrowserDownloadSettings();
    const downloadDirectory = resolveBrowserDownloadDirectory(
      settings.directory,
      app.getPath('downloads'),
    );
    const downloadSession = originWebContents?.session ?? browserPanelSession;
    const agentClaim = claimBrowserAgentDownload(downloadSession, item, originWebContents);
    if (agentClaim?.cancelled) {
      item.cancel();
      return;
    }
    const askWhereToSave = agentClaim ? false : settings.askWhereToSave;
    const automaticSavePath =
      agentClaim?.savePath ??
      (askWhereToSave
        ? undefined
        : resolveAvailableBrowserDownloadPath(
            downloadDirectory,
            item.getFilename(),
            candidate => reservedDownloadPaths.has(candidate) || fs.existsSync(candidate),
          ));
    downloadIds.set(item, id);
    downloadDefaultDirectories.set(item, downloadDirectory);
    if (automaticSavePath) reservedDownloadPaths.add(automaticSavePath);
    try {
      recordBrowserDownload(
        {
          id,
          fileName: path.basename(item.getFilename()) || 'download',
          sourceUrl: sanitizeBrowserUrl(item.getURL()),
          state: askWhereToSave ? 'queued' : 'progressing',
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          startedAt: now,
          updatedAt: now,
        },
        automaticSavePath,
      );
    } catch (error) {
      console.warn(
        '[BrowserPanel] Failed to record download:',
        error instanceof Error ? error.message : String(error),
      );
    }
    item.on('updated', (_downloadEvent, state) => {
      scheduleDownloadUpdate(item, state === 'interrupted' ? 'interrupted' : 'progressing');
    });
    item.once('done', (_downloadEvent, state) => {
      const timer = downloadUpdateTimers.get(item);
      if (timer) clearTimeout(timer);
      downloadUpdateTimers.delete(item);
      persistDownloadUpdate(item, state);
      pendingDownloads.delete(item);
      if (automaticSavePath) reservedDownloadPaths.delete(automaticSavePath);
      agentClaim?.settle(item, state);
    });
    if (askWhereToSave) {
      item.pause();
      pendingDownloads.add(item);
      downloadConfirmationQueue = downloadConfirmationQueue.then(
        () => confirmBrowserDownload(item),
        () => confirmBrowserDownload(item),
      );
    } else if (automaticSavePath) {
      try {
        item.setSavePath(automaticSavePath);
      } catch (error) {
        reservedDownloadPaths.delete(automaticSavePath);
        item.cancel();
        persistDownloadUpdate(item, 'cancelled');
        console.warn(
          '[BrowserPanel] Failed to apply the automatic download destination:',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };
  browserPanelSessions.forEach(browserSession =>
    browserSession.on('will-download', handleBrowserDownload),
  );
  mainWindow.once('closed', () => {
    browserPanelSessions.forEach(browserSession =>
      browserSession.off('will-download', handleBrowserDownload),
    );
    downloadUpdateTimers.forEach(timer => clearTimeout(timer));
    downloadUpdateTimers.clear();
    pendingDownloads.forEach(item => item.cancel());
    pendingDownloads.clear();
    cancelAllBrowserAgentDownloads();
    reservedDownloadPaths.clear();
  });
  if (options.isDev && process.env.JUSTDO_DEBUG_CHAT_TIMELINE === 'true') {
    mainWindow.webContents.on('console-message', details => {
      if (
        details.message.startsWith(CHAT_TIMELINE_TRACE_PREFIX) &&
        Buffer.byteLength(details.message, 'utf8') <= CHAT_TIMELINE_TRACE_MAX_BYTES
      ) {
        console.info(details.message);
      }
    });
  }

  const loadTimeout = options.isDev
    ? undefined
    : setTimeout(() => {
        if (!mainWindow.isDestroyed() && mainWindow.webContents.isLoadingMainFrame()) {
          console.log('[MainWindow] Load timed out, attempting to reload.');
          options.scheduleReload('load-timeout');
        }
      }, LOAD_TIMEOUT_MS);

  mainWindow.webContents.once('did-finish-load', () => {
    if (loadTimeout) {
      clearTimeout(loadTimeout);
    }
  });
  mainWindow.webContents.on('did-finish-load', () => options.onDidFinishLoad(mainWindow));

  mainWindow.on('close', event => {
    if (!options.isQuitting() && !options.isDev) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  if (options.isDev) {
    let retryCount = 0;
    const tryLoadUrl = (): void => {
      void mainWindow.loadURL(options.devServerUrl).catch(error => {
        console.error('[MainWindow] Failed to load development URL:', error);
        retryCount += 1;
        if (retryCount < DEV_LOAD_MAX_RETRIES) {
          setTimeout(tryLoadUrl, LOAD_RETRY_DELAY_MS);
          return;
        }
        console.error('[MainWindow] Failed to load development URL after maximum retries.');
        if (!mainWindow.isDestroyed()) {
          void mainWindow.loadFile(path.join(__dirname, '../resources/error.html'));
        }
      });
    };
    tryLoadUrl();

    mainWindow.webContents.on('before-input-event', (_event, input) => {
      const isDevtoolsShortcut =
        input.key === 'F12' ||
        ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i');

      if (isDevtoolsShortcut) {
        mainWindow.webContents.toggleDevTools();
      }
    });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[MainWindow] Page failed to load:', errorCode, errorDescription);
    if (options.isDev) {
      setTimeout(() => options.scheduleReload('did-fail-load'), LOAD_RETRY_DELAY_MS);
    }
  });

  const forwardWindowState = (): void => options.onWindowStateChanged(mainWindow);
  mainWindow.on('maximize', forwardWindowState);
  mainWindow.on('unmaximize', forwardWindowState);
  mainWindow.on('enter-full-screen', forwardWindowState);
  mainWindow.on('leave-full-screen', forwardWindowState);
  mainWindow.on('focus', forwardWindowState);
  mainWindow.on('blur', forwardWindowState);

  mainWindow.once('ready-to-show', () => options.onReadyToShow(mainWindow));
  return mainWindow;
};
