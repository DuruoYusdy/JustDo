export const isAllowedBrowserPanelUrl = (value: string): boolean => {
  if (!value || value === 'about:blank') return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
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
import path from 'path';
import { fileURLToPath } from 'url';
