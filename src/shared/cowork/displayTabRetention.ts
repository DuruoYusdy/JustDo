export const DEFAULT_MAX_RETAINED_DISPLAY_TABS = 30;
export const MIN_MAX_RETAINED_DISPLAY_TABS = 0;
export const MAX_MAX_RETAINED_DISPLAY_TABS = 200;

export const normalizeMaxRetainedDisplayTabs = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_RETAINED_DISPLAY_TABS;
  return Math.min(
    MAX_MAX_RETAINED_DISPLAY_TABS,
    Math.max(MIN_MAX_RETAINED_DISPLAY_TABS, Math.round(parsed)),
  );
};
