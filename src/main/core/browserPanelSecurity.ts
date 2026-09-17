import path from 'path';
import { fileURLToPath } from 'url';

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.azure.internal',
  'instance-data.ec2.internal',
]);

export const isBlockedBrowserMetadataHost = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/u, '');
  if (METADATA_HOSTNAMES.has(normalized)) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some(value => value > 255)) return false;
    return (
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 100 && octets[1] === 100 && octets[2] === 100 && octets[3] === 200)
    );
  }
  const firstHextet = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
  return (
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
    normalized === 'fd00:ec2::254' ||
    normalized.startsWith('::ffff:a9fe:') ||
    normalized.startsWith('::ffff:169.254.')
  );
};

export const isAllowedBrowserPanelUrl = (value: string): boolean => {
  if (!value || value === 'about:blank') return true;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !isBlockedBrowserMetadataHost(url.hostname)
    );
  } catch {
    return false;
  }
};

export const isAllowedMainWindowNavigation = (
  value: string,
  options: { appRoot: string; devServerUrl: string; isDev: boolean },
): boolean => {
  try {
    const url = new URL(value);
    if (options.isDev) return url.origin === new URL(options.devServerUrl).origin;
    if (url.protocol !== 'file:') return false;
    const relative = path.relative(path.resolve(options.appRoot), path.resolve(fileURLToPath(url)));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
};
