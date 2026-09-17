import { session } from 'electron';

import {
  BROWSER_IMPORTED_PROFILE_PARTITION,
  BROWSER_PANEL_PARTITION,
} from '../../shared/browser';
import {
  type CustomProxyConfig,
  defaultCustomProxyConfig,
  ProxyMode,
  ProxyProtocol,
  type ProxySettings,
} from '../../shared/proxy';
import {
  applySystemProxyEnv,
  resolveSystemProxyUrl,
  restoreOriginalProxyEnv,
  setFixedProxyUrl,
  setSystemProxyEnabled,
} from './systemProxy';

export type SystemProxySettings = {
  useSystemProxy?: boolean;
  proxy?: Partial<ProxySettings>;
};

const dynamicBrowserSessions = new Map<string, Electron.Session>();
let currentProxySettings: SystemProxySettings | undefined;

export const isSystemProxyEnabled = (config?: SystemProxySettings): boolean => {
  return resolveProxyMode(config) === ProxyMode.SYSTEM;
};

const resolveProxyMode = (config?: SystemProxySettings): ProxyMode => {
  if (config?.proxy?.mode === ProxyMode.SYSTEM || config?.useSystemProxy === true) {
    return ProxyMode.SYSTEM;
  }
  if (config?.proxy?.mode === ProxyMode.CUSTOM) {
    return ProxyMode.CUSTOM;
  }
  return ProxyMode.DIRECT;
};

const normalizeCustomProxy = (custom?: Partial<CustomProxyConfig>): CustomProxyConfig => {
  const protocol = Object.values(ProxyProtocol).includes(custom?.protocol as ProxyProtocol)
    ? (custom?.protocol as ProxyProtocol)
    : defaultCustomProxyConfig.protocol;

  return {
    protocol,
    host: custom?.host?.trim() ?? '',
    port: custom?.port?.trim() ?? '',
    username: custom?.username?.trim() ?? '',
    password: custom?.password ?? '',
  };
};

const buildCustomProxyUrl = (custom: CustomProxyConfig): string | null => {
  const host = custom.host.trim();
  const port = custom.port.trim();
  if (!host || !port) {
    return null;
  }

  const username = custom.username?.trim();
  const password = custom.password ?? '';
  const credentials = username
    ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : '';

  try {
    const parsedPort = Number(port);
    const url = new URL(`${custom.protocol}://${credentials}${host}:${port}`);
    if (!url.hostname || !Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
      return null;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const removeProxyCredentials = (proxyUrl: string): string | null => {
  try {
    const url = new URL(proxyUrl);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const applyProxyToSessions = async (
  targetSessions: Electron.Session[],
  settings: SystemProxySettings | undefined,
): Promise<void> => {
  const proxyMode = resolveProxyMode(settings);
  if (proxyMode === ProxyMode.SYSTEM) {
    await Promise.all(targetSessions.map(target => target.setProxy({ mode: ProxyMode.SYSTEM })));
  } else if (proxyMode === ProxyMode.CUSTOM) {
    const customProxyUrl = buildCustomProxyUrl(normalizeCustomProxy(settings?.proxy?.custom));
    const proxyRules = customProxyUrl ? removeProxyCredentials(customProxyUrl) : null;
    if (proxyRules) {
      await Promise.all(
        targetSessions.map(target =>
          target.setProxy({
            mode: 'fixed_servers',
            proxyRules,
            proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
          }),
        ),
      );
    } else {
      await Promise.all(targetSessions.map(target => target.setProxy({ mode: ProxyMode.DIRECT })));
    }
  } else {
    await Promise.all(targetSessions.map(target => target.setProxy({ mode: ProxyMode.DIRECT })));
  }
  await Promise.all(targetSessions.map(target => target.closeAllConnections()));
};

export const registerBrowserProxySession = async (
  targetSession: Electron.Session,
): Promise<void> => {
  const key = targetSession.storagePath;
  if (!key || dynamicBrowserSessions.has(key)) return;
  dynamicBrowserSessions.set(key, targetSession);
  await applyProxyToSessions([targetSession], currentProxySettings).catch(error => {
    console.error('[SystemProxy] Failed to apply proxy mode to browser profile:', error);
  });
};

export const getProxyPreferenceSignature = (config?: SystemProxySettings): string => {
  const mode = resolveProxyMode(config);
  const custom = normalizeCustomProxy(config?.proxy?.custom);
  return JSON.stringify({
    mode,
    custom: mode === ProxyMode.CUSTOM ? custom : undefined,
  });
};

const applySystemProxyPreferenceNow = async (
  config: SystemProxySettings | boolean | undefined,
): Promise<void> => {
  const settings = typeof config === 'boolean' ? { useSystemProxy: config } : config;
  currentProxySettings = settings;
  const proxyMode = resolveProxyMode(settings);
  const useSystemProxy = proxyMode === ProxyMode.SYSTEM;
  const targetSessions = [
    session.defaultSession,
    session.fromPartition(BROWSER_PANEL_PARTITION),
    session.fromPartition(BROWSER_IMPORTED_PROFILE_PARTITION),
    ...dynamicBrowserSessions.values(),
  ];

  try {
    await applyProxyToSessions(targetSessions, settings);
  } catch (error) {
    console.error('[SystemProxy] Failed to apply session proxy mode:', error);
  }

  setSystemProxyEnabled(useSystemProxy);

  if (proxyMode === ProxyMode.CUSTOM) {
    const customProxyUrl = buildCustomProxyUrl(normalizeCustomProxy(settings?.proxy?.custom));
    setFixedProxyUrl(customProxyUrl);
    applySystemProxyEnv(customProxyUrl);

    if (customProxyUrl) {
      console.log('[SystemProxy] Custom proxy enabled for process environment.');
    } else {
      console.warn('[SystemProxy] Custom proxy selected, but host or port is empty.');
    }
    return;
  }

  if (proxyMode === ProxyMode.DIRECT) {
    setFixedProxyUrl(null);
    restoreOriginalProxyEnv();
    console.log('[SystemProxy] Disabled; using direct mode.');
    return;
  }

  setFixedProxyUrl(null);
  const proxyUrl = await resolveSystemProxyUrl('https://proxy-check.invalid');
  applySystemProxyEnv(proxyUrl);

  if (proxyUrl) {
    console.log('[SystemProxy] Enabled for process environment:', proxyUrl);
  } else {
    console.warn('[SystemProxy] Enabled, but no proxy endpoint was resolved (DIRECT).');
  }
};

let proxyPreferenceGeneration = 0;
let proxyPreferenceApplyQueue: Promise<void> = Promise.resolve();

/**
 * Applies proxy changes in order and reports whether this request is still the
 * latest preference. Callers should only perform follow-up work (such as a
 * Gateway restart) when the returned value is true.
 */
export const applySystemProxyPreference = (
  config: SystemProxySettings | boolean | undefined,
): Promise<boolean> => {
  const generation = ++proxyPreferenceGeneration;
  const operation = proxyPreferenceApplyQueue.then(async () => {
    if (generation !== proxyPreferenceGeneration) {
      return false;
    }
    await applySystemProxyPreferenceNow(config);
    return generation === proxyPreferenceGeneration;
  });

  proxyPreferenceApplyQueue = operation.then(
    (): void => undefined,
    (): void => undefined,
  );
  return operation;
};
