import path from 'path';

import { PRODUCT_NAME } from '../../../shared/productMetadata';

export const resolvePackagedMulticaAgentExecutable = (productExecutable: string): string =>
  path.join(path.dirname(productExecutable), `${PRODUCT_NAME}-agent.exe`);

export const resolveMulticaDevAgentExecutable = (_appPath: string, userDataPath: string): string =>
  path.join(userDataPath, 'multica', 'development', `${PRODUCT_NAME}-agent.exe`);

export const resolveMulticaDevApplicationPath = (appPath: string): string => path.resolve(appPath);
