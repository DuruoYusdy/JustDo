import { connect } from 'node:net';

import { DEV_SERVER_URL_SWITCH } from './appConstants';
import { getDevServerUrlFromCommandLine } from './devServerHandoff';

const CHECK_INTERVAL_MS = 1_000;
const FAILURE_LIMIT = 3;

export const probeDevServer = (serverUrl: string): Promise<boolean> =>
  new Promise(resolve => {
    const url = new URL(serverUrl);
    const socket = connect({
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port),
    });
    const finish = (alive: boolean): void => {
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(CHECK_INTERVAL_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });

// Follow the server used by the window, not its original parent process: a
// native host can launch Electron and a later terminal can reuse that instance.
export const createDevSessionLifecycle = (
  onSessionEnded: () => void,
  probe: (url: string) => Promise<boolean> = probeDevServer,
) => {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => {
    generation += 1;
    clearTimeout(timer);
  };

  const follow = (candidate: string): void => {
    const url = getDevServerUrlFromCommandLine([`${DEV_SERVER_URL_SWITCH}=${candidate}`]);
    if (!url) return;
    stop();
    const currentGeneration = generation;
    let failures = 0;
    const check = async (): Promise<void> => {
      const alive = await probe(url).catch(() => false);
      if (generation !== currentGeneration) return;
      failures = alive ? 0 : failures + 1;
      if (failures >= FAILURE_LIMIT) {
        stop();
        onSessionEnded();
        return;
      }
      timer = setTimeout(() => void check(), CHECK_INTERVAL_MS);
      timer.unref();
    };
    timer = setTimeout(() => void check(), CHECK_INTERVAL_MS);
    timer.unref();
  };

  return { follow, stop };
};
