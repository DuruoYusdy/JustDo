export const NetworkIpc = {
  Fetch: 'api:fetch',
  CancelFetch: 'api:cancelFetch',
} as const;

export const NetworkFetchPurpose = {
  ModelDiscovery: 'model-discovery',
  ModelConnectionTest: 'model-connection-test',
  NonLanguageModelDiscovery: 'non-language-model-discovery',
} as const;

export type NetworkFetchPurpose = (typeof NetworkFetchPurpose)[keyof typeof NetworkFetchPurpose];

export interface ApiFetchOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  requestId?: string;
  purpose?: NetworkFetchPurpose;
}
