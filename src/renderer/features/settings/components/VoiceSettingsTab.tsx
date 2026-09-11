import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';
import {
  isLocalAsrLanguageSupported,
  LOCAL_ASR_MODEL_IDS,
  type LocalAsrModelId,
} from '@shared/localAsr';
import { LocalSpeechModelKind, type LocalSpeechModelStatus } from '@shared/localSpeechModels';
import {
  LOCAL_SPEECH_MAX_MEETING_SEGMENT_SECONDS,
  LOCAL_SPEECH_MAX_RATE,
  LOCAL_SPEECH_MAX_RECORDING_SECONDS,
  LOCAL_SPEECH_MAX_THREADS,
  LOCAL_SPEECH_MIN_MEETING_SEGMENT_SECONDS,
  LOCAL_SPEECH_MIN_RATE,
  LOCAL_SPEECH_MIN_RECORDING_SECONDS,
  LOCAL_SPEECH_MIN_THREADS,
  type LocalSpeechSettings,
} from '@shared/localSpeechSettings';
import { LOCAL_TTS_MODEL_ID, LOCAL_TTS_MODEL_IDS, type LocalTtsModelId } from '@shared/localTts';
import type { OnlineAsrConfiguration } from '@shared/onlineAsr';
import type { OnlineTtsConfiguration } from '@shared/onlineTts';
import React, { useEffect, useState } from 'react';

import { i18nService } from '@/services/i18n';
import ThemedSelect from '@/shared/components/ui/ThemedSelect';

interface VoiceSettingsTabProps {
  value: LocalSpeechSettings;
  onChange: (value: LocalSpeechSettings) => void;
}

const VOICE_OPTIONS = [
  { value: '3', key: 'voiceSpeakerChineseFemale1' },
  { value: '4', key: 'voiceSpeakerChineseFemale2' },
  { value: '5', key: 'voiceSpeakerChineseFemale3' },
  { value: '58', key: 'voiceSpeakerChineseMale1' },
  { value: '59', key: 'voiceSpeakerChineseMale2' },
  { value: '60', key: 'voiceSpeakerChineseMale3' },
  { value: '0', key: 'voiceSpeakerAmericanFemale1' },
  { value: '1', key: 'voiceSpeakerAmericanFemale2' },
  { value: '2', key: 'voiceSpeakerBritishFemale' },
] as const;

const ASR_MODEL_KEYS: Record<LocalAsrModelId, string> = {
  'sherpa-onnx-whisper-base': 'voiceAsrModelWhisperBase',
  'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09': 'voiceAsrModelSenseVoice',
};

const TTS_MODEL_KEYS: Record<LocalTtsModelId, string> = {
  'kokoro-int8-multi-lang-v1_1': 'voiceTtsModelKokoro',
  'vits-icefall-zh-aishell3': 'voiceTtsModelAishell3',
  'vits-piper-en_US-lessac-medium-int8': 'voiceTtsModelPiperEnglish',
};

const SettingSwitch: React.FC<{
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ checked, label, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-label={label}
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
      checked ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
    } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
  >
    <span
      className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const NumberSetting: React.FC<{
  id: string;
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}> = ({ id, label, description, value, min, max, step = 1, suffix, disabled, onChange }) => (
  <div className={`flex items-center justify-between gap-8 ${disabled ? 'opacity-50' : ''}`}>
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <p className="mt-1 text-xs leading-5 text-secondary">{description}</p>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={event => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
        className="h-9 w-24 rounded-lg border border-border bg-surface px-3 text-right text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed"
      />
      <span className="w-12 text-xs text-secondary">{suffix}</span>
    </div>
  </div>
);

const ModelStatus: React.FC<{
  status: LocalSpeechModelStatus | null;
  loading: boolean;
  showInstallAction: boolean;
  onRetry: () => void;
  onRemove: () => void;
}> = ({ status, loading, showInstallAction, onRetry, onRemove }) => {
  const busy = status?.phase === 'downloading' || status?.phase === 'installing';
  const available = status?.phase === 'ready';
  const statusText = (() => {
    if (loading) return i18nService.t('voiceModelChecking');
    if (status?.phase === 'downloading') {
      return `${i18nService.t('voiceModelDownloading')} ${status.downloadPercent ?? 0}%`;
    }
    if (status?.phase === 'installing') return i18nService.t('voiceModelInstalling');
    if (available) return i18nService.t('voiceModelReady');
    if (status?.phase === 'error') return status.error || i18nService.t('voiceModelDownloadFailed');
    return i18nService.t('voiceModelNotInstalled');
  })();
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-secondary"
      role="status"
      aria-live="polite"
    >
      {loading || busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : available ? (
        <CheckCircleIcon className="h-4 w-4 text-green-500" />
      ) : (
        <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" />
      )}
      <span>{statusText}</span>
      {status?.id ? (
        <code className="max-w-full truncate rounded bg-surface-raised px-1.5 py-0.5">
          {status.id}
        </code>
      ) : null}
      {status?.downloadBytes ? (
        <span>{`${status.downloadBytesExact === false ? '≈' : ''}${(status.downloadBytes / 1024 / 1024).toFixed(1)} MiB`}</span>
      ) : null}
      {showInstallAction && (status?.phase === 'error' || status?.phase === 'not-installed') ? (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-primary hover:underline"
        >
          {status.phase === 'error' ? i18nService.t('retry') : i18nService.t('voiceModelDownload')}
        </button>
      ) : null}
      {available ? (
        <button
          type="button"
          onClick={onRemove}
          className="font-medium text-secondary hover:underline"
        >
          {i18nService.t('voiceModelRemove')}
        </button>
      ) : null}
    </div>
  );
};

const VoiceSettingsTab: React.FC<VoiceSettingsTabProps> = ({ value, onChange }) => {
  const [statuses, setStatuses] = useState<LocalSpeechModelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [onlineStatus, setOnlineStatus] = useState<OnlineAsrConfiguration | null>(null);
  const [onlineStatusLoading, setOnlineStatusLoading] = useState(false);
  const [onlineProvider, setOnlineProvider] = useState('');
  const [onlineBaseUrl, setOnlineBaseUrl] = useState('');
  const [onlineModel, setOnlineModel] = useState('');
  const [onlineApiKey, setOnlineApiKey] = useState('');
  const [showOnlineApiKey, setShowOnlineApiKey] = useState(false);
  const [onlineSaving, setOnlineSaving] = useState(false);
  const [onlineSaveState, setOnlineSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [onlineTtsStatus, setOnlineTtsStatus] = useState<OnlineTtsConfiguration | null>(null);
  const [onlineTtsStatusLoading, setOnlineTtsStatusLoading] = useState(false);
  const [onlineTtsProvider, setOnlineTtsProvider] = useState('');
  const [onlineTtsBaseUrl, setOnlineTtsBaseUrl] = useState('');
  const [onlineTtsModel, setOnlineTtsModel] = useState('');
  const [onlineTtsVoice, setOnlineTtsVoice] = useState('');
  const [onlineTtsApiKey, setOnlineTtsApiKey] = useState('');
  const [showOnlineTtsApiKey, setShowOnlineTtsApiKey] = useState(false);
  const [onlineTtsSaving, setOnlineTtsSaving] = useState(false);
  const [onlineTtsSaveState, setOnlineTtsSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const update = (patch: Partial<LocalSpeechSettings>) => onChange({ ...value, ...patch });
  const asrStatus = statuses.find(status => status.id === value.asrModelId) ?? null;
  const ttsStatus = statuses.find(status => status.id === value.ttsModelId) ?? null;

  const install = (kind: LocalSpeechModelKind, id: string) => {
    void window.electron.localSpeechModels
      .install(kind, id)
      .then(result => {
        setStatuses(current => [
          ...current.filter(status => status.id !== result.status.id),
          result.status,
        ]);
      })
      .catch(() => undefined);
  };
  const remove = (kind: LocalSpeechModelKind, id: string) => {
    void window.electron.localSpeechModels
      .remove(kind, id)
      .then(result => {
        setStatuses(current => [
          ...current.filter(status => status.id !== result.status.id),
          result.status,
        ]);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (value.recognitionMode !== 'online') {
      setOnlineStatus(null);
      setOnlineStatusLoading(false);
      return;
    }
    let active = true;
    setOnlineStatusLoading(true);
    void window.electron.onlineAsr
      .getConfiguration()
      .then(configuration => {
        if (!active) return;
        setOnlineStatus(configuration);
        const provider = configuration.selectedProvider ?? configuration.providers[0]?.id ?? '';
        setOnlineProvider(provider);
        setOnlineBaseUrl(configuration.baseUrl ?? '');
        setOnlineModel(configuration.model ?? '');
        setOnlineApiKey('');
        setShowOnlineApiKey(false);
        setOnlineSaveState('idle');
      })
      .catch(error => {
        if (active) {
          setOnlineStatus({
            available: false,
            providers: [],
            credentialConfigured: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (active) setOnlineStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [value.recognitionMode]);

  const selectedOnlineProvider = onlineStatus?.providers.find(
    provider => provider.id === onlineProvider,
  );
  const saveOnlineConfiguration = () => {
    if (!onlineProvider || onlineSaving) return;
    setOnlineSaving(true);
    setOnlineSaveState('idle');
    void window.electron.onlineAsr
      .saveConfiguration({
        provider: onlineProvider,
        baseUrl: onlineBaseUrl.trim(),
        ...(onlineApiKey.trim() ? { apiKey: onlineApiKey.trim() } : {}),
        model: onlineModel.trim(),
      })
      .then(() => {
        const suppliedCredential = Boolean(onlineApiKey.trim());
        setOnlineApiKey('');
        setShowOnlineApiKey(false);
        setOnlineSaveState('saved');
        setOnlineStatus(current =>
          current
            ? {
                ...current,
                available: true,
                provider: onlineProvider,
                selectedProvider: onlineProvider,
                baseUrl: onlineBaseUrl.trim(),
                model: onlineModel.trim(),
                credentialConfigured:
                  suppliedCredential || selectedOnlineProvider?.configured === true,
                providers: current.providers.map(provider =>
                  provider.id === onlineProvider && suppliedCredential
                    ? { ...provider, configured: true }
                    : provider,
                ),
              }
            : current,
        );
        window.dispatchEvent(new CustomEvent('config-updated'));
      })
      .catch(() => setOnlineSaveState('error'))
      .finally(() => setOnlineSaving(false));
  };

  useEffect(() => {
    if (value.synthesisMode !== 'online') {
      setOnlineTtsStatus(null);
      setOnlineTtsStatusLoading(false);
      return;
    }
    let active = true;
    setOnlineTtsStatusLoading(true);
    void window.electron.onlineTts
      .getConfiguration()
      .then(configuration => {
        if (!active) return;
        setOnlineTtsStatus(configuration);
        const provider = configuration.selectedProvider ?? configuration.providers[0]?.id ?? '';
        setOnlineTtsProvider(provider);
        setOnlineTtsBaseUrl(configuration.baseUrl ?? '');
        setOnlineTtsModel(configuration.model ?? '');
        setOnlineTtsVoice(configuration.voice ?? '');
        setOnlineTtsApiKey('');
        setShowOnlineTtsApiKey(false);
        setOnlineTtsSaveState('idle');
      })
      .catch(error => {
        if (!active) return;
        setOnlineTtsStatus({
          available: false,
          providers: [],
          credentialConfigured: false,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (active) setOnlineTtsStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [value.synthesisMode]);

  const selectedOnlineTtsProvider = onlineTtsStatus?.providers.find(
    provider => provider.id === onlineTtsProvider,
  );
  const saveOnlineTtsConfiguration = () => {
    if (!onlineTtsProvider || onlineTtsSaving) return;
    setOnlineTtsSaving(true);
    setOnlineTtsSaveState('idle');
    void window.electron.onlineTts
      .saveConfiguration({
        provider: onlineTtsProvider,
        baseUrl: onlineTtsBaseUrl.trim(),
        ...(onlineTtsApiKey.trim() ? { apiKey: onlineTtsApiKey.trim() } : {}),
        model: onlineTtsModel.trim(),
        voice: onlineTtsVoice.trim(),
      })
      .then(() => {
        const suppliedCredential = Boolean(onlineTtsApiKey.trim());
        setOnlineTtsApiKey('');
        setShowOnlineTtsApiKey(false);
        setOnlineTtsSaveState('saved');
        setOnlineTtsStatus(current =>
          current
            ? {
                ...current,
                available: true,
                provider: onlineTtsProvider,
                selectedProvider: onlineTtsProvider,
                baseUrl: onlineTtsBaseUrl.trim(),
                model: onlineTtsModel.trim(),
                voice: onlineTtsVoice.trim(),
                credentialConfigured:
                  suppliedCredential || selectedOnlineTtsProvider?.configured === true,
                providers: current.providers.map(provider =>
                  provider.id === onlineTtsProvider && suppliedCredential
                    ? { ...provider, configured: true }
                    : provider,
                ),
              }
            : current,
        );
        window.dispatchEvent(new CustomEvent('config-updated'));
      })
      .catch(() => setOnlineTtsSaveState('error'))
      .finally(() => setOnlineTtsSaving(false));
  };

  useEffect(() => {
    let active = true;
    const unsubscribe = window.electron.localSpeechModels.onChanged(status => {
      if (!active) return;
      setStatuses(current => [...current.filter(candidate => candidate.id !== status.id), status]);
    });
    void window.electron.localSpeechModels
      .list()
      .then(result => {
        if (!active) return;
        setStatuses(result.models);
      })
      .catch(() => {
        if (!active) return;
        setStatuses([]);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!value.inputEnabled || !navigator.mediaDevices?.enumerateDevices) return;
    let active = true;
    const refresh = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then(devices => {
          if (!active) return;
          const seen = new Set<string>();
          setMicrophones(
            devices.filter(device => {
              const id = device.deviceId.trim();
              if (device.kind !== 'audioinput' || !id || id === 'default' || seen.has(id)) {
                return false;
              }
              seen.add(id);
              return true;
            }),
          );
        })
        .catch(() => {
          if (active) setMicrophones([]);
        });
    };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [value.inputEnabled]);

  return (
    <div className="space-y-6">
      <p className="text-sm leading-6 text-secondary">
        {i18nService.t('voiceSettingsDescription')}
      </p>

      <section className="space-y-5 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {i18nService.t('voiceInputTitle')}
            </h4>
            <p className="mt-1 text-xs leading-5 text-secondary">
              {i18nService.t('voiceInputDescription')}
            </p>
          </div>
          <SettingSwitch
            checked={value.inputEnabled}
            label={i18nService.t('voiceInputEnabled')}
            onChange={inputEnabled => {
              update({ inputEnabled });
            }}
          />
        </div>
        {value.recognitionMode === 'local' ? (
          <ModelStatus
            status={asrStatus}
            loading={loading}
            showInstallAction={value.inputEnabled}
            onRetry={() => install(LocalSpeechModelKind.Asr, value.asrModelId)}
            onRemove={() => remove(LocalSpeechModelKind.Asr, value.asrModelId)}
          />
        ) : (
          <div className="flex items-center gap-2 text-xs text-secondary" role="status">
            {onlineStatusLoading ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : onlineStatus?.available ? (
              <CheckCircleIcon className="h-4 w-4 text-green-500" />
            ) : (
              <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" />
            )}
            <span>
              {onlineStatusLoading
                ? i18nService.t('voiceOnlineChecking')
                : onlineStatus?.available
                  ? i18nService.t('voiceOnlineReady')
                  : i18nService.t('voiceOnlineUnavailable')}
            </span>
            {onlineStatus?.provider ? (
              <code className="rounded bg-surface-raised px-1.5 py-0.5">
                {onlineStatus.provider}
              </code>
            ) : null}
          </div>
        )}
        <div className="border-t border-border pt-5">
          <div className="mb-5 flex items-center justify-between gap-8">
            <div>
              <label
                htmlFor="voice-recognition-mode"
                className="text-sm font-medium text-foreground"
              >
                {i18nService.t('voiceRecognitionMode')}
              </label>
              <p className="mt-1 text-xs leading-5 text-secondary">
                {i18nService.t('voiceRecognitionModeDescription')}
              </p>
            </div>
            <div className="w-52 shrink-0">
              <ThemedSelect
                id="voice-recognition-mode"
                value={value.recognitionMode}
                onChange={recognitionMode => {
                  const nextMode = recognitionMode as LocalSpeechSettings['recognitionMode'];
                  update({
                    recognitionMode: nextMode,
                    ...(nextMode === 'online' && value.inputSource === 'file'
                      ? { inputSource: 'microphone' as const }
                      : {}),
                    ...(nextMode === 'online' && value.inputLanguage === 'yue'
                      ? { inputLanguage: 'app' as const }
                      : {}),
                  });
                }}
                options={[
                  { value: 'local', label: i18nService.t('voiceRecognitionModeLocal') },
                  { value: 'online', label: i18nService.t('voiceRecognitionModeOnline') },
                ]}
              />
            </div>
          </div>
          {value.recognitionMode === 'local' ? (
            <div className="mb-5 flex items-center justify-between gap-8">
              <div>
                <label htmlFor="voice-asr-model" className="text-sm font-medium text-foreground">
                  {i18nService.t('voiceRecognitionModel')}
                </label>
                <p className="mt-1 text-xs leading-5 text-secondary">
                  {i18nService.t('voiceModelDownloadDescription')}
                </p>
              </div>
              <div className="w-52 shrink-0">
                <ThemedSelect
                  id="voice-asr-model"
                  value={value.asrModelId}
                  disabled={!value.inputEnabled}
                  onChange={asrModelId => {
                    const nextModelId = asrModelId as LocalAsrModelId;
                    update({
                      asrModelId: nextModelId,
                      ...(!isLocalAsrLanguageSupported(nextModelId, value.inputLanguage)
                        ? { inputLanguage: 'app' as const }
                        : {}),
                    });
                  }}
                  options={LOCAL_ASR_MODEL_IDS.map(modelId => ({
                    value: modelId,
                    label: i18nService.t(ASR_MODEL_KEYS[modelId]),
                  }))}
                />
              </div>
            </div>
          ) : (
            <div className="mb-5 space-y-3 rounded-lg border border-border bg-surface-raised/40 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="voice-online-provider" className="text-xs text-secondary">
                    {i18nService.t('voiceOnlineProvider')}
                  </label>
                  <div className="mt-1.5">
                    <ThemedSelect
                      id="voice-online-provider"
                      value={onlineProvider}
                      disabled={onlineStatusLoading || !onlineStatus?.providers.length}
                      onChange={providerId => {
                        setOnlineProvider(providerId);
                        setOnlineBaseUrl('');
                        setOnlineModel('');
                        setOnlineApiKey('');
                        setShowOnlineApiKey(false);
                        setOnlineSaveState('idle');
                      }}
                      options={(onlineStatus?.providers ?? []).map(provider => ({
                        value: provider.id,
                        label: provider.label,
                      }))}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="voice-online-base-url" className="text-xs text-secondary">
                    {i18nService.t('voiceOnlineBaseUrl')}
                  </label>
                  <input
                    id="voice-online-base-url"
                    type="url"
                    value={onlineBaseUrl}
                    disabled={!onlineProvider}
                    onChange={event => {
                      setOnlineBaseUrl(event.target.value);
                      setOnlineSaveState('idle');
                    }}
                    placeholder={i18nService.t('voiceOnlineBaseUrlPlaceholder')}
                    className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="voice-online-model" className="text-xs text-secondary">
                    {i18nService.t('voiceOnlineModel')}
                  </label>
                  <input
                    id="voice-online-model"
                    value={onlineModel}
                    disabled={!onlineProvider}
                    onChange={event => {
                      setOnlineModel(event.target.value);
                      setOnlineSaveState('idle');
                    }}
                    className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div>
                  <label htmlFor="voice-online-api-key" className="text-xs text-secondary">
                    {i18nService.t('voiceOnlineApiKey')}
                  </label>
                  <div className="mt-1.5 flex min-w-0 gap-2">
                    <div className="relative min-w-0 flex-1">
                      <input
                        id="voice-online-api-key"
                        type={showOnlineApiKey ? 'text' : 'password'}
                        autoComplete="off"
                        value={onlineApiKey}
                        disabled={!onlineProvider}
                        onChange={event => {
                          setOnlineApiKey(event.target.value);
                          setOnlineSaveState('idle');
                        }}
                        placeholder={
                          selectedOnlineProvider?.configured
                            ? i18nService.t('voiceOnlineApiKeyConfigured')
                            : i18nService.t('voiceOnlineApiKeyPlaceholder')
                        }
                        className="h-9 w-full rounded-lg border border-border bg-surface py-2 pl-3 pr-10 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={!onlineProvider}
                        aria-label={i18nService.t(
                          showOnlineApiKey ? 'voiceOnlineHideApiKey' : 'voiceOnlineShowApiKey',
                        )}
                        onClick={() => setShowOnlineApiKey(current => !current)}
                        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-secondary transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {showOnlineApiKey ? (
                          <EyeSlashIcon className="h-4 w-4" />
                        ) : (
                          <EyeIcon className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={
                        !onlineProvider ||
                        !onlineBaseUrl.trim() ||
                        !onlineModel.trim() ||
                        onlineSaving ||
                        (!onlineApiKey.trim() && selectedOnlineProvider?.configured !== true)
                      }
                      title={
                        onlineSaveState === 'saved'
                          ? i18nService.t('voiceOnlineSaved')
                          : onlineSaveState === 'error'
                            ? i18nService.t('voiceOnlineSaveFailed')
                            : undefined
                      }
                      onClick={saveOnlineConfiguration}
                      className="h-9 shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {onlineSaving
                        ? i18nService.t('voiceOnlineSaving')
                        : onlineSaveState === 'saved'
                          ? i18nService.t('voiceOnlineSavedShort')
                          : onlineSaveState === 'error'
                            ? i18nService.t('retry')
                            : i18nService.t('voiceOnlineSave')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="mb-5 flex items-center justify-between gap-8">
            <div>
              <label htmlFor="voice-input-source" className="text-sm font-medium text-foreground">
                {i18nService.t('voiceInputSource')}
              </label>
              <p className="mt-1 text-xs leading-5 text-secondary">
                {i18nService.t('voiceInputSourceDescription')}
              </p>
            </div>
            <div className="w-52 shrink-0">
              <ThemedSelect
                id="voice-input-source"
                value={value.inputSource}
                disabled={!value.inputEnabled}
                onChange={inputSource =>
                  update({ inputSource: inputSource as LocalSpeechSettings['inputSource'] })
                }
                options={[
                  { value: 'microphone', label: i18nService.t('voiceInputSourceMicrophone') },
                  { value: 'system', label: i18nService.t('voiceInputSourceSystem') },
                  { value: 'microphone-system', label: i18nService.t('voiceInputSourceMixed') },
                  ...(value.recognitionMode === 'local'
                    ? [{ value: 'file', label: i18nService.t('voiceInputSourceFile') }]
                    : []),
                ]}
              />
            </div>
          </div>
          {(value.inputSource === 'microphone' || value.inputSource === 'microphone-system') && (
            <div className="mb-5 flex items-center justify-between gap-8">
              <div>
                <label htmlFor="voice-input-device" className="text-sm font-medium text-foreground">
                  {i18nService.t('voiceInputDevice')}
                </label>
                <p className="mt-1 text-xs leading-5 text-secondary">
                  {i18nService.t('voiceInputDeviceDescription')}
                </p>
              </div>
              <div className="w-52 shrink-0">
                <ThemedSelect
                  id="voice-input-device"
                  value={value.inputDeviceId}
                  disabled={!value.inputEnabled}
                  onChange={inputDeviceId => update({ inputDeviceId })}
                  options={[
                    { value: '', label: i18nService.t('voiceInputDeviceDefault') },
                    ...(value.inputDeviceId &&
                    !microphones.some(device => device.deviceId === value.inputDeviceId)
                      ? [
                          {
                            value: value.inputDeviceId,
                            label: i18nService.t('voiceInputDeviceDisconnected'),
                          },
                        ]
                      : []),
                    ...microphones.map((device, index) => ({
                      value: device.deviceId,
                      label: device.label || `${i18nService.t('voiceInputDevice')} ${index + 1}`,
                    })),
                  ]}
                />
              </div>
            </div>
          )}
          {value.recognitionMode === 'local' ? (
            <div className="flex items-center justify-between gap-8">
              <div>
                <label
                  htmlFor="voice-input-language"
                  className="text-sm font-medium text-foreground"
                >
                  {i18nService.t('voiceRecognitionLanguage')}
                </label>
                <p className="mt-1 text-xs leading-5 text-secondary">
                  {i18nService.t('voiceRecognitionLanguageDescription')}
                </p>
              </div>
              <div className="w-44 shrink-0">
                <ThemedSelect
                  id="voice-input-language"
                  value={value.inputLanguage}
                  disabled={!value.inputEnabled}
                  onChange={inputLanguage =>
                    update({ inputLanguage: inputLanguage as LocalSpeechSettings['inputLanguage'] })
                  }
                  options={[
                    { value: 'auto', label: i18nService.t('voiceLanguageAuto') },
                    { value: 'app', label: i18nService.t('voiceLanguageFollowApp') },
                    { value: 'zh', label: i18nService.t('chinese') },
                    { value: 'en', label: i18nService.t('english') },
                    ...(value.recognitionMode === 'local' &&
                    value.asrModelId.includes('sense-voice')
                      ? [{ value: 'yue', label: i18nService.t('cantonese') }]
                      : []),
                    { value: 'ja', label: i18nService.t('japanese') },
                    { value: 'ko', label: i18nService.t('korean') },
                  ]}
                />
              </div>
            </div>
          ) : null}
        </div>
        <NumberSetting
          id="voice-max-recording"
          label={i18nService.t('voiceMaxRecording')}
          description={i18nService.t('voiceMaxRecordingDescription')}
          value={value.maxRecordingSeconds}
          min={LOCAL_SPEECH_MIN_RECORDING_SECONDS}
          max={LOCAL_SPEECH_MAX_RECORDING_SECONDS}
          suffix={i18nService.t('seconds')}
          disabled={!value.inputEnabled || value.meetingMode}
          onChange={maxRecordingSeconds => update({ maxRecordingSeconds })}
        />
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm font-medium text-foreground">
              {i18nService.t('voiceMeetingMode')}
            </div>
            <p className="mt-1 text-xs leading-5 text-secondary">
              {i18nService.t('voiceMeetingModeDescription')}
            </p>
          </div>
          <SettingSwitch
            checked={value.meetingMode}
            label={i18nService.t('voiceMeetingMode')}
            disabled={!value.inputEnabled}
            onChange={meetingMode => update({ meetingMode })}
          />
        </div>
        {value.meetingMode && value.recognitionMode === 'local' && (
          <NumberSetting
            id="voice-meeting-segment"
            label={i18nService.t('voiceMeetingSegment')}
            description={i18nService.t('voiceMeetingSegmentDescription')}
            value={value.meetingSegmentSeconds}
            min={LOCAL_SPEECH_MIN_MEETING_SEGMENT_SECONDS}
            max={LOCAL_SPEECH_MAX_MEETING_SEGMENT_SECONDS}
            suffix={i18nService.t('seconds')}
            disabled={!value.inputEnabled}
            onChange={meetingSegmentSeconds => update({ meetingSegmentSeconds })}
          />
        )}
        {value.recognitionMode === 'local' ? (
          <NumberSetting
            id="voice-recognition-threads"
            label={i18nService.t('voiceRecognitionThreads')}
            description={i18nService.t('voiceThreadsDescription')}
            value={value.recognitionThreads}
            min={LOCAL_SPEECH_MIN_THREADS}
            max={LOCAL_SPEECH_MAX_THREADS}
            suffix={i18nService.t('voiceThreadsUnit')}
            disabled={!value.inputEnabled}
            onChange={recognitionThreads => update({ recognitionThreads })}
          />
        ) : null}
      </section>

      <section className="space-y-5 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {i18nService.t('voiceOutputTitle')}
            </h4>
            <p className="mt-1 text-xs leading-5 text-secondary">
              {i18nService.t('voiceOutputDescription')}
            </p>
          </div>
          <SettingSwitch
            checked={value.outputEnabled}
            label={i18nService.t('voiceOutputEnabled')}
            onChange={outputEnabled => {
              update({ outputEnabled });
            }}
          />
        </div>
        {value.synthesisMode === 'local' ? (
          <ModelStatus
            status={ttsStatus}
            loading={loading}
            showInstallAction={value.outputEnabled}
            onRetry={() => install(LocalSpeechModelKind.Tts, value.ttsModelId)}
            onRemove={() => remove(LocalSpeechModelKind.Tts, value.ttsModelId)}
          />
        ) : (
          <div className="flex items-center gap-2 text-xs text-secondary" role="status">
            {onlineTtsStatusLoading ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : onlineTtsStatus?.available ? (
              <CheckCircleIcon className="h-4 w-4 text-green-500" />
            ) : (
              <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" />
            )}
            <span>
              {onlineTtsStatusLoading
                ? i18nService.t('voiceOnlineTtsChecking')
                : onlineTtsStatus?.available
                  ? i18nService.t('voiceOnlineTtsReady')
                  : i18nService.t('voiceOnlineTtsUnavailable')}
            </span>
            {onlineTtsStatus?.provider ? (
              <code className="rounded bg-surface-raised px-1.5 py-0.5">
                {onlineTtsStatus.provider}
              </code>
            ) : null}
          </div>
        )}
        <div className="border-t border-border pt-5">
          <div className="mb-5 flex items-center justify-between gap-8">
            <div>
              <label htmlFor="voice-synthesis-mode" className="text-sm font-medium text-foreground">
                {i18nService.t('voiceSynthesisMode')}
              </label>
              <p className="mt-1 text-xs leading-5 text-secondary">
                {i18nService.t('voiceSynthesisModeDescription')}
              </p>
            </div>
            <div className="w-52 shrink-0">
              <ThemedSelect
                id="voice-synthesis-mode"
                value={value.synthesisMode}
                onChange={synthesisMode => {
                  const nextMode = synthesisMode as LocalSpeechSettings['synthesisMode'];
                  update({ synthesisMode: nextMode });
                }}
                options={[
                  { value: 'local', label: i18nService.t('voiceSynthesisModeLocal') },
                  { value: 'online', label: i18nService.t('voiceSynthesisModeOnline') },
                ]}
              />
            </div>
          </div>
          {value.synthesisMode === 'local' ? (
            <>
              <div className="mb-5 flex items-center justify-between gap-8">
                <div>
                  <label htmlFor="voice-tts-model" className="text-sm font-medium text-foreground">
                    {i18nService.t('voiceSynthesisModel')}
                  </label>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    {i18nService.t('voiceModelDownloadDescription')}
                  </p>
                </div>
                <div className="w-52 shrink-0">
                  <ThemedSelect
                    id="voice-tts-model"
                    value={value.ttsModelId}
                    disabled={!value.outputEnabled}
                    onChange={ttsModelId => {
                      update({
                        ttsModelId: ttsModelId as LocalTtsModelId,
                        voiceId: ttsModelId === LOCAL_TTS_MODEL_ID ? 3 : 0,
                      });
                    }}
                    options={LOCAL_TTS_MODEL_IDS.map(modelId => ({
                      value: modelId,
                      label: i18nService.t(TTS_MODEL_KEYS[modelId]),
                    }))}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-8">
                <div>
                  <label htmlFor="voice-speaker" className="text-sm font-medium text-foreground">
                    {i18nService.t('voiceSpeaker')}
                  </label>
                  <p className="mt-1 text-xs leading-5 text-secondary">
                    {i18nService.t('voiceSpeakerDescription')}
                  </p>
                </div>
                <div className="w-52 shrink-0">
                  <ThemedSelect
                    id="voice-speaker"
                    value={String(value.voiceId)}
                    disabled={!value.outputEnabled}
                    onChange={voiceId => update({ voiceId: Number(voiceId) })}
                    options={
                      value.ttsModelId === LOCAL_TTS_MODEL_ID
                        ? VOICE_OPTIONS.map(option => ({
                            value: option.value,
                            label: i18nService.t(option.key),
                          }))
                        : value.ttsModelId === 'vits-icefall-zh-aishell3'
                          ? Array.from({ length: 174 }, (_, voiceId) => ({
                              value: String(voiceId),
                              label: `${i18nService.t('voiceSpeaker')} ${voiceId}`,
                            }))
                          : [{ value: '0', label: i18nService.t('voiceSpeakerDefault') }]
                    }
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3 rounded-lg border border-border bg-surface-raised/40 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="voice-online-tts-provider" className="text-xs text-secondary">
                    {i18nService.t('voiceOnlineProvider')}
                  </label>
                  <div className="mt-1.5">
                    <ThemedSelect
                      id="voice-online-tts-provider"
                      value={onlineTtsProvider}
                      disabled={onlineTtsStatusLoading || !onlineTtsStatus?.providers.length}
                      onChange={providerId => {
                        setOnlineTtsProvider(providerId);
                        setOnlineTtsBaseUrl('');
                        setOnlineTtsModel('');
                        setOnlineTtsVoice('');
                        setOnlineTtsApiKey('');
                        setShowOnlineTtsApiKey(false);
                        setOnlineTtsSaveState('idle');
                      }}
                      options={(onlineTtsStatus?.providers ?? []).map(provider => ({
                        value: provider.id,
                        label: provider.label,
                      }))}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="voice-online-tts-base-url" className="text-xs text-secondary">
                    {i18nService.t('voiceOnlineBaseUrl')}
                  </label>
                  <input
                    id="voice-online-tts-base-url"
                    type="url"
                    value={onlineTtsBaseUrl}
                    disabled={!onlineTtsProvider}
                    onChange={event => {
                      setOnlineTtsBaseUrl(event.target.value);
                      setOnlineTtsSaveState('idle');
                    }}
                    placeholder={i18nService.t('voiceOnlineBaseUrlPlaceholder')}
                    className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
                <div>
                  <label htmlFor="voice-online-tts-model" className="text-xs text-secondary">
                    {i18nService.t('voiceSynthesisModel')}
                  </label>
                  <input
                    id="voice-online-tts-model"
                    value={onlineTtsModel}
                    disabled={!onlineTtsProvider}
                    onChange={event => {
                      setOnlineTtsModel(event.target.value);
                      setOnlineTtsSaveState('idle');
                    }}
                    className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div>
                  <label htmlFor="voice-online-tts-voice" className="text-xs text-secondary">
                    {i18nService.t('voiceSpeaker')}
                  </label>
                  <input
                    id="voice-online-tts-voice"
                    value={onlineTtsVoice}
                    disabled={!onlineTtsProvider}
                    onChange={event => {
                      setOnlineTtsVoice(event.target.value);
                      setOnlineTtsSaveState('idle');
                    }}
                    className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div>
                  <label htmlFor="voice-online-tts-api-key" className="text-xs text-secondary">
                    {i18nService.t('voiceOnlineApiKey')}
                  </label>
                  <div className="mt-1.5 flex min-w-0 gap-2">
                    <div className="relative min-w-0 flex-1">
                      <input
                        id="voice-online-tts-api-key"
                        type={showOnlineTtsApiKey ? 'text' : 'password'}
                        autoComplete="off"
                        value={onlineTtsApiKey}
                        disabled={!onlineTtsProvider}
                        onChange={event => {
                          setOnlineTtsApiKey(event.target.value);
                          setOnlineTtsSaveState('idle');
                        }}
                        placeholder={
                          selectedOnlineTtsProvider?.configured
                            ? i18nService.t('voiceOnlineApiKeyConfigured')
                            : i18nService.t('voiceOnlineApiKeyPlaceholder')
                        }
                        className="h-9 w-full rounded-lg border border-border bg-surface py-2 pl-3 pr-10 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={!onlineTtsProvider}
                        aria-label={i18nService.t(
                          showOnlineTtsApiKey ? 'voiceOnlineHideApiKey' : 'voiceOnlineShowApiKey',
                        )}
                        onClick={() => setShowOnlineTtsApiKey(current => !current)}
                        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-secondary transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {showOnlineTtsApiKey ? (
                          <EyeSlashIcon className="h-4 w-4" />
                        ) : (
                          <EyeIcon className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={
                        !onlineTtsProvider ||
                        !onlineTtsBaseUrl.trim() ||
                        !onlineTtsModel.trim() ||
                        !onlineTtsVoice.trim() ||
                        onlineTtsSaving ||
                        (!onlineTtsApiKey.trim() && selectedOnlineTtsProvider?.configured !== true)
                      }
                      title={
                        onlineTtsSaveState === 'saved'
                          ? i18nService.t('voiceOnlineSaved')
                          : onlineTtsSaveState === 'error'
                            ? i18nService.t('voiceOnlineSaveFailed')
                            : undefined
                      }
                      onClick={saveOnlineTtsConfiguration}
                      className="h-9 shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {onlineTtsSaving
                        ? i18nService.t('voiceOnlineSaving')
                        : onlineTtsSaveState === 'saved'
                          ? i18nService.t('voiceOnlineSavedShort')
                          : onlineTtsSaveState === 'error'
                            ? i18nService.t('retry')
                            : i18nService.t('voiceOnlineSave')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        {value.synthesisMode === 'local' ? (
          <>
            <NumberSetting
              id="voice-speech-rate"
              label={i18nService.t('voiceSpeechRate')}
              description={i18nService.t('voiceSpeechRateDescription')}
              value={value.speechRate}
              min={LOCAL_SPEECH_MIN_RATE}
              max={LOCAL_SPEECH_MAX_RATE}
              step={0.1}
              suffix="×"
              disabled={!value.outputEnabled}
              onChange={speechRate => update({ speechRate })}
            />
            <NumberSetting
              id="voice-synthesis-threads"
              label={i18nService.t('voiceSynthesisThreads')}
              description={i18nService.t('voiceThreadsDescription')}
              value={value.synthesisThreads}
              min={LOCAL_SPEECH_MIN_THREADS}
              max={LOCAL_SPEECH_MAX_THREADS}
              suffix={i18nService.t('voiceThreadsUnit')}
              disabled={!value.outputEnabled}
              onChange={synthesisThreads => update({ synthesisThreads })}
            />
          </>
        ) : null}
      </section>
    </div>
  );
};

export default VoiceSettingsTab;
