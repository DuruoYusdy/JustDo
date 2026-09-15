import { createHash } from 'crypto';

const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000;

export const chromeTimestampToUnixMs = (value: number): number =>
  Math.max(0, Math.floor(value / 1000 - CHROME_EPOCH_OFFSET_MS));

export const sanitizeBrowserHistoryUrl = (value: string): string | null => {
  if (value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    return url.toString().slice(0, 4096);
  } catch {
    return null;
  }
};

export const mapChromeCookieSameSite = (
  value: number,
): 'unspecified' | 'no_restriction' | 'lax' | 'strict' =>
  value === 0 ? 'no_restriction' : value === 1 ? 'lax' : value === 2 ? 'strict' : 'unspecified';

export const stripChromeCookieHostDigest = (
  value: Buffer,
  hostKey: string,
  databaseVersion: number,
): Buffer | null => {
  if (databaseVersion < 24) return value;
  const digest = createHash('sha256').update(hostKey).digest();
  if (value.length < digest.length || !value.subarray(0, digest.length).equals(digest)) return null;
  return value.subarray(digest.length);
};

export type ChromeCookieRow = {
  host_key: string;
  name: string;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
  top_frame_site_key: string;
};

export type ImportedCookieDetails = {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  expirationDate?: number;
};

export const buildChromeCookieDetails = (
  row: ChromeCookieRow,
  decrypted: Buffer,
  databaseVersion: number,
): ImportedCookieDetails | null => {
  // Electron cannot set a CHIPS partition key. Importing this as an ordinary cookie would
  // broaden its scope, so partitioned rows are deliberately rejected.
  if (row.top_frame_site_key) return null;
  const value = stripChromeCookieHostDigest(decrypted, row.host_key, databaseVersion);
  if (!value) return null;
  const host = row.host_key.replace(/^\./, '');
  if (!host || !row.name) return null;
  const cookiePath = row.path.startsWith('/') ? row.path : '/';
  return {
    url: `${row.is_secure ? 'https' : 'http'}://${host}${cookiePath}`,
    name: row.name,
    value: value.toString('utf8'),
    ...(row.host_key.startsWith('.') ? { domain: row.host_key } : {}),
    path: cookiePath,
    secure: Boolean(row.is_secure),
    httpOnly: Boolean(row.is_httponly),
    sameSite: mapChromeCookieSameSite(row.samesite),
    ...(row.expires_utc > 0
      ? { expirationDate: chromeTimestampToUnixMs(row.expires_utc) / 1000 }
      : {}),
  };
};
