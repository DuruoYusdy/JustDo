import { ipcMain } from 'electron';

import { WindowsSandboxIpc } from '../../../shared/windowsSandbox';
import type { CoworkStore } from '../../data/coworkStore';
import type { WindowsSandboxService } from '../../security/windowsSandboxService';

type Dependencies = {
  getCoworkStore: () => CoworkStore;
  getWindowsSandboxService: () => WindowsSandboxService;
};

export const registerWindowsSandboxHandlers = ({
  getCoworkStore,
  getWindowsSandboxService,
}: Dependencies): void => {
  ipcMain.handle(WindowsSandboxIpc.GetStatus, () => getWindowsSandboxService().getStatus());
  ipcMain.handle(WindowsSandboxIpc.Initialize, () => {
    const workspace = getCoworkStore().getConfig().workingDirectory;
    return getWindowsSandboxService().initialize(workspace);
  });
  ipcMain.handle(WindowsSandboxIpc.Repair, () => {
    const workspace = getCoworkStore().getConfig().workingDirectory;
    return getWindowsSandboxService().repair(workspace);
  });
  ipcMain.handle(WindowsSandboxIpc.OpenDiagnostics, () =>
    getWindowsSandboxService().openDiagnostics(),
  );
};
