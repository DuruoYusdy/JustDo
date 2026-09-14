export type CustomOnlineModelKind =
  | 'speech-recognition'
  | 'speech-synthesis'
  | 'image'
  | 'video';

const ENDPOINT_SUFFIXES: Record<CustomOnlineModelKind, string> = {
  'speech-recognition': '/realtime',
  'speech-synthesis': '/audio/speech',
  image: '/images/generations',
  video: '/videos',
};

const removePathSuffix = (pathname: string, suffix: string): string =>
  pathname.toLowerCase().endsWith(suffix.toLowerCase())
    ? pathname.slice(0, -suffix.length) || '/'
    : pathname;

const appendUrlPath = (baseUrl: string, suffix: string): string => {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = `${path}${suffix}`;
  url.hash = '';
  return url.toString();
};

export const normalizeCustomOnlineBaseUrl = (
  kind: CustomOnlineModelKind,
  baseUrl: string,
): string => {
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    url.pathname = removePathSuffix(
      url.pathname.replace(/\/+$/, '') || '/',
      ENDPOINT_SUFFIXES[kind],
    );
    if (kind === 'speech-recognition') url.searchParams.delete('intent');
    url.hash = '';
    return url.toString();
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

export const buildCustomOnlineEndpointPreview = (
  kind: CustomOnlineModelKind,
  baseUrl: string,
): string => {
  const normalized = normalizeCustomOnlineBaseUrl(kind, baseUrl);
  if (!normalized) return '';
  const suffix = ENDPOINT_SUFFIXES[kind];

  try {
    const url = new URL(normalized);
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = `${path}${suffix}`;
    url.hash = '';
    if (kind !== 'speech-recognition') return url.toString();
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    url.searchParams.set('intent', 'transcription');
    return url.toString();
  } catch {
    return `${normalized}${suffix}${kind === 'speech-recognition' ? '?intent=transcription' : ''}`;
  }
};

export const buildCustomOnlineModelsUrl = (
  kind: CustomOnlineModelKind,
  baseUrl: string,
): string => {
  const normalized = normalizeCustomOnlineBaseUrl(kind, baseUrl);
  const modelsUrl = new URL(appendUrlPath(normalized, '/models'));
  if (modelsUrl.protocol === 'ws:') modelsUrl.protocol = 'http:';
  if (modelsUrl.protocol === 'wss:') modelsUrl.protocol = 'https:';
  return modelsUrl.toString();
};

export const buildVoiceDiscoveryUrls = (baseUrl: string): string[] => {
  const normalized = normalizeCustomOnlineBaseUrl('speech-synthesis', baseUrl);
  const base = new URL(normalized);
  const serviceRoot = new URL(normalized);
  serviceRoot.pathname = serviceRoot.pathname.replace(/\/v\d+\/?$/i, '') || '/';
  return [
    appendUrlPath(base.toString(), '/audio/voices'),
    appendUrlPath(base.toString(), '/voices'),
    appendUrlPath(serviceRoot.toString(), '/api/voices'),
  ];
};

export const buildCustomOnlineOpenApiUrl = (
  kind: CustomOnlineModelKind,
  baseUrl: string,
): string => {
  const serviceRoot = new URL(normalizeCustomOnlineBaseUrl(kind, baseUrl));
  serviceRoot.pathname = serviceRoot.pathname.replace(/\/v\d+\/?$/i, '') || '/';
  serviceRoot.search = '';
  return appendUrlPath(serviceRoot.toString(), '/openapi.json');
};
