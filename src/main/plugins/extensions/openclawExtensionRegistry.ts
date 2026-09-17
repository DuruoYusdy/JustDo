import { OpenClawExtensionId } from '../../../shared/openclaw/extensions';
import { ScheduledTaskAgentId } from '../../../shared/scheduledTask/constants';

export type OpenClawExtensionDescriptor = {
  id: string;
  buildEntry: (automationApprovalTimeoutMinutes: number) => Record<string, unknown>;
};

export const bundledOpenClawExtensions: readonly OpenClawExtensionDescriptor[] = [
  {
    id: OpenClawExtensionId.ASK_USER_QUESTION,
    buildEntry: () => ({ enabled: true }),
  },
  {
    id: OpenClawExtensionId.AUTOMATION_PERMISSION,
    buildEntry: approvalTimeoutMinutes => ({
      enabled: true,
      config: {
        unrestrictedAgentIds: [ScheduledTaskAgentId],
        approvalTimeoutMinutes,
      },
    }),
  },
  {
    id: OpenClawExtensionId.RUNTIME_SERVICES,
    buildEntry: () => ({ enabled: true }),
  },
  {
    id: OpenClawExtensionId.PLAN_MODE,
    buildEntry: () => ({ enabled: true }),
  },
  {
    id: OpenClawExtensionId.EMBEDDED_BROWSER,
    // Fail closed. Config sync enables this provider only for embedded mode,
    // where the native Browser plugin is explicitly disabled.
    buildEntry: () => ({ enabled: false }),
  },
] as const;

export const buildBundledExtensionEntries = (
  isAvailable: (id: string) => boolean,
  automationApprovalTimeoutMinutes: number,
): Record<string, Record<string, unknown>> => {
  return Object.fromEntries(
    bundledOpenClawExtensions
      .filter(extension => isAvailable(extension.id))
      .map(extension => [extension.id, extension.buildEntry(automationApprovalTimeoutMinutes)]),
  );
};
