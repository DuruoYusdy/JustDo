export const MODEL_PROVIDER_HEADER_LIMITS = {
  count: 32,
  nameLength: 128,
  valueBytes: 8 * 1024,
} as const;

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const FORBIDDEN_HEADER_NAMES = new Set([
  '__proto__',
  'connection',
  'constructor',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'prototype',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export type ModelProviderHeaderValidationError =
  | 'empty-name'
  | 'invalid-name'
  | 'forbidden-name'
  | 'duplicate-name'
  | 'invalid-value'
  | 'too-many-headers';

export const validateModelProviderHeaderName = (
  value: string,
): Exclude<
  ModelProviderHeaderValidationError,
  'duplicate-name' | 'invalid-value' | 'too-many-headers'
> | null => {
  const name = value.trim();
  if (!name) return 'empty-name';
  if (name.length > MODEL_PROVIDER_HEADER_LIMITS.nameLength || !HEADER_NAME_PATTERN.test(name)) {
    return 'invalid-name';
  }
  if (FORBIDDEN_HEADER_NAMES.has(name.toLowerCase())) return 'forbidden-name';
  return null;
};

export const validateModelProviderHeaderValue = (
  value: string,
): Extract<ModelProviderHeaderValidationError, 'invalid-value'> | null =>
  !value.trim() ||
  /[\r\n]/.test(value) ||
  new TextEncoder().encode(value).byteLength > MODEL_PROVIDER_HEADER_LIMITS.valueBytes
    ? 'invalid-value'
    : null;

/** Validate and normalize a provider header map without exposing its values. */
export const normalizeModelProviderHeaders = (
  headers: Record<string, string> | undefined,
  maxCount: number = MODEL_PROVIDER_HEADER_LIMITS.count,
): Record<string, string> => {
  if (!headers) return {};
  const entries = Object.entries(headers);
  if (entries.length > maxCount) {
    throw new Error('too-many-headers' satisfies ModelProviderHeaderValidationError);
  }
  const normalizedEntries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const [rawName, value] of entries) {
    const name = rawName.trim();
    const nameError = validateModelProviderHeaderName(name);
    if (nameError) throw new Error(nameError);
    if (typeof value !== 'string' || validateModelProviderHeaderValue(value)) {
      throw new Error('invalid-value' satisfies ModelProviderHeaderValidationError);
    }
    const identity = name.toLowerCase();
    if (seen.has(identity)) {
      throw new Error('duplicate-name' satisfies ModelProviderHeaderValidationError);
    }
    seen.add(identity);
    normalizedEntries.push([name, value]);
  }
  return Object.fromEntries(normalizedEntries);
};

export const mergeModelProviderHeaders = (
  base: Record<string, string>,
  custom: Record<string, string> | undefined,
): Record<string, string> => {
  const normalizedCustom = normalizeModelProviderHeaders(custom);
  const customNames = new Set(Object.keys(normalizedCustom).map(name => name.toLowerCase()));
  return {
    ...Object.fromEntries(
      Object.entries(base).filter(([name]) => !customNames.has(name.toLowerCase())),
    ),
    ...normalizedCustom,
  };
};
