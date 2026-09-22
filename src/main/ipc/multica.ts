import { ipcMain } from 'electron';

import { MulticaIntegrationIpc } from '../../shared/integrations/multica';
import type { MulticaIntegrationService } from '../integrations/multica/multicaIntegrationService';

export const registerMulticaIntegrationHandlers = (
  getService: () => MulticaIntegrationService,
): void => {
  ipcMain.handle(MulticaIntegrationIpc.GetStatus, () => getService().getStatus());
  ipcMain.handle(MulticaIntegrationIpc.Enable, () => getService().enable());
  ipcMain.handle(MulticaIntegrationIpc.Disable, () => getService().disable());
  ipcMain.handle(MulticaIntegrationIpc.Refresh, () => getService().refresh());
};
