import { DEV_SERVER_URL_SWITCH } from '../appConstants';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export const getDevServerUrlFromCommandLine = (commandLine: readonly string[]): string | null => {
  const prefix = `${DEV_SERVER_URL_SWITCH}=`;
  const argument = commandLine.find(value => value.startsWith(prefix));
  const candidate = argument?.slice(prefix.length).trim();
  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);
    const port = Number(url.port);
    if (
      url.protocol !== 'http:' ||
      !LOOPBACK_HOSTNAMES.has(url.hostname) ||
      url.username ||
      url.password ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
};
