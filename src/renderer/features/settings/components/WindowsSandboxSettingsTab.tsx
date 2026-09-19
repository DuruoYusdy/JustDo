import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import type { WindowsSandboxStatus } from '@shared/windowsSandbox';
import React, { useCallback, useEffect, useState } from 'react';

import { i18nService } from '@/services/i18n';

type ExecutionMode = 'local' | 'sandbox';

const statusLabel = (status: WindowsSandboxStatus | null): string => {
  if (!status) return i18nService.t('windowsSandboxChecking');
  return i18nService.t(`windowsSandboxStatus_${status.code}`);
};

const WindowsSandboxSettingsTab: React.FC = () => {
  const [status, setStatus] = useState<WindowsSandboxStatus | null>(null);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('local');
  const [sandboxNetworkEnabled, setSandboxNetworkEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const [nextStatus, configResult] = await Promise.all([
      window.electron.cowork.getWindowsSandboxStatus(),
      window.electron.cowork.getConfig(),
    ]);
    setStatus(nextStatus);
    if (configResult.success && configResult.config) {
      setExecutionMode(configResult.config.executionMode === 'sandbox' ? 'sandbox' : 'local');
      setSandboxNetworkEnabled(configResult.config.sandboxNetworkEnabled);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(loadError => {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
  }, [refresh]);

  const updateMode = async (nextMode: ExecutionMode) => {
    if (nextMode === 'sandbox' && !status?.ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electron.cowork.setConfig({ executionMode: nextMode });
      if (!result.success) throw new Error(result.error || i18nService.t('saveFailed'));
      setExecutionMode(nextMode);
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setBusy(false);
    }
  };

  const updateNetworkAccess = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.electron.cowork.setConfig({ sandboxNetworkEnabled: enabled });
      if (!result.success) throw new Error(result.error || i18nService.t('saveFailed'));
      setSandboxNetworkEnabled(enabled);
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setBusy(false);
    }
  };

  const initialize = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.electron.cowork.initializeWindowsSandbox();
      setStatus(result.status);
      if (!result.success) throw new Error(result.error);
    } catch (initializationError) {
      setError(
        initializationError instanceof Error
          ? initializationError.message
          : String(initializationError),
      );
    } finally {
      setBusy(false);
    }
  };

  const openDiagnostics = async () => {
    setError(null);
    try {
      const result = await window.electron.cowork.openWindowsSandboxDiagnostics();
      if (!result.success) throw new Error(result.error || i18nService.t('saveFailed'));
    } catch (diagnosticsError) {
      setError(
        diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError),
      );
    }
  };

  const statusIcon = status?.ready ? (
    <CheckCircleIcon className="h-5 w-5 text-success" />
  ) : (
    <ExclamationTriangleIcon className="h-5 w-5 text-warning" />
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-subtle">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-muted text-primary">
            <ShieldCheckIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-base font-semibold text-foreground">
              {i18nService.t('windowsSandboxTitle')}
            </h4>
            <p className="mt-1 text-sm leading-6 text-secondary">
              {i18nService.t('windowsSandboxDescription')}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {statusIcon}
            <span>{statusLabel(status)}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
              {i18nService.t('refresh')}
            </button>
            {status?.supported && status.helperAvailable && status.hostPreparationRecommended && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void initialize()}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {busy
                  ? i18nService.t('windowsSandboxInitializing')
                  : i18nService.t('windowsSandboxInitialize')}
              </button>
            )}
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">
          {i18nService.t('windowsSandboxExecutionMode')}
        </h4>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 hover:bg-surface-raised">
          <input
            type="radio"
            name="executionMode"
            checked={executionMode === 'local'}
            disabled={busy}
            onChange={() => void updateMode('local')}
            className="mt-0.5 h-4 w-4 text-primary"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              {i18nService.t('windowsSandboxLocalMode')}
            </span>
            <span className="mt-1 block text-xs leading-5 text-secondary">
              {i18nService.t('windowsSandboxLocalModeDescription')}
            </span>
          </span>
        </label>
        <label
          className={`flex items-start gap-3 rounded-xl border border-border p-4 ${
            status?.ready
              ? 'cursor-pointer hover:bg-surface-raised'
              : 'cursor-not-allowed opacity-60'
          }`}
        >
          <input
            type="radio"
            name="executionMode"
            checked={executionMode === 'sandbox'}
            disabled={busy || !status?.ready}
            onChange={() => void updateMode('sandbox')}
            className="mt-0.5 h-4 w-4 text-primary"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              {i18nService.t('windowsSandboxMode')}
            </span>
            <span className="mt-1 block text-xs leading-5 text-secondary">
              {i18nService.t('windowsSandboxModeDescription')}
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">
          {i18nService.t('windowsSandboxNetworkAccess')}
        </h4>
        <label
          className={`flex items-start gap-3 rounded-xl border border-border p-4 ${
            executionMode === 'sandbox'
              ? 'cursor-pointer hover:bg-surface-raised'
              : 'cursor-not-allowed opacity-60'
          }`}
        >
          <input
            type="checkbox"
            checked={sandboxNetworkEnabled}
            disabled={busy || executionMode !== 'sandbox'}
            onChange={event => void updateNetworkAccess(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-primary"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              {i18nService.t('windowsSandboxAllowNetwork')}
            </span>
            <span className="mt-1 block text-xs leading-5 text-secondary">
              {i18nService.t('windowsSandboxAllowNetworkDescription')}
            </span>
          </span>
        </label>
        {sandboxNetworkEnabled && executionMode === 'sandbox' && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
            {i18nService.t('windowsSandboxNetworkWarning')}
          </p>
        )}
      </section>

      {status?.diagnosticsPath && (
        <button
          type="button"
          onClick={() => void openDiagnostics()}
          className="text-sm font-medium text-primary hover:text-primary-hover"
        >
          {i18nService.t('windowsSandboxOpenDiagnostics')}
        </button>
      )}
    </div>
  );
};

export default WindowsSandboxSettingsTab;
