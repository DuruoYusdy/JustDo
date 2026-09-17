import type { BrowserPanelTab } from '@shared/browser';

const retainedTabsByDraftKey = new Map<string, BrowserPanelTab[]>();

export const getRetainedBrowserPanelTabs = (draftKey: string): BrowserPanelTab[] | undefined =>
  retainedTabsByDraftKey.get(draftKey);

export const setRetainedBrowserPanelTabs = (
  draftKey: string,
  tabs: BrowserPanelTab[],
): void => {
  retainedTabsByDraftKey.set(draftKey, tabs);
};

export const promoteBrowserPanelTabs = (fromDraftKey: string, toDraftKey: string): void => {
  if (fromDraftKey === toDraftKey) return;
  const tabs = retainedTabsByDraftKey.get(fromDraftKey);
  if (!tabs) return;
  retainedTabsByDraftKey.set(toDraftKey, tabs);
  retainedTabsByDraftKey.delete(fromDraftKey);
};

export const removeRetainedBrowserPanelTabs = (draftKey: string): void => {
  retainedTabsByDraftKey.delete(draftKey);
};
