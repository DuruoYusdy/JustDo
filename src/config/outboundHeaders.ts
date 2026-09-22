export type OutboundHeaderPolicyGroup = {
  baseUrlWhitelist: readonly string[];
  headerNames: readonly string[];
};

export type OutboundHeaderPolicyConfig = {
  /** 保留字段，保持 false。 */
  overwrite: boolean;
  enabled: boolean;
  groups: readonly OutboundHeaderPolicyGroup[];
};

export const DEFAULT_OUTBOUND_HEADER_POLICY_CONFIG: OutboundHeaderPolicyConfig = Object.freeze({
  overwrite: false,
  enabled: true,
  groups: Object.freeze([
    Object.freeze({
      baseUrlWhitelist: Object.freeze([]),
      headerNames: Object.freeze(['X-User-Account', 'X-Cookie']),
    }),
  ]),
});
