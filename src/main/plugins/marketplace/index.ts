import type { PluginInstallationService } from '../installation';
import {
  type MarketplaceInstallRecordStore,
  MarketplaceInstallRegistry,
} from './marketplaceInstallRegistry';
import { PluginMarketplaceService } from './pluginMarketplaceService';

// Product builds register the configured enterprise provider here. Keeping the
// default empty avoids coupling the application boundary to a public market.
export const createPluginMarketplaceService = (
  installationService: PluginInstallationService,
  getStore?: () => MarketplaceInstallRecordStore,
): PluginMarketplaceService =>
  new PluginMarketplaceService(
    [],
    installationService,
    getStore ? new MarketplaceInstallRegistry(getStore) : undefined,
  );

export { PluginMarketplaceService } from './pluginMarketplaceService';
export type { PluginMarketplaceProvider } from './types';
