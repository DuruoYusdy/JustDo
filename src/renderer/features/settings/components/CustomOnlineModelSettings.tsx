import {
  CheckIcon,
  CubeIcon,
  EyeIcon,
  EyeSlashIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { normalizeOpenClawProviderId } from '@shared/providers';
import React, { useMemo, useState } from 'react';

import type { AppConfig } from '@/app/config';
import { configService } from '@/services/config';
import { i18nService } from '@/services/i18n';

export type CustomOnlineModelKind = 'speech-recognition' | 'speech-synthesis' | 'image' | 'video';

type Category = NonNullable<AppConfig['onlineModelProviders']>[CustomOnlineModelKind];
type Provider = NonNullable<Category>['providers'][string];

const emptyCategory = (): NonNullable<Category> => ({ providers: {} });

const PROTOCOL_HINT_KEYS = {
  'speech-recognition': 'customRecognitionProtocolHint',
  'speech-synthesis': 'customSynthesisProtocolHint',
  image: 'customImageProtocolHint',
  video: 'customVideoProtocolHint',
} as const;

interface Props {
  kind: CustomOnlineModelKind;
}

const CustomOnlineModelSettings: React.FC<Props> = ({ kind }) => {
  const initial = configService.getConfig().onlineModelProviders?.[kind] ?? emptyCategory();
  const [category, setCategory] = useState<NonNullable<Category>>(() => structuredClone(initial));
  const [activeProviderId, setActiveProviderId] = useState(Object.keys(initial.providers)[0] ?? '');
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerName, setProviderName] = useState('');
  const [modelDialog, setModelDialog] = useState<{ previousId?: string } | null>(null);
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [formError, setFormError] = useState('');

  const providerEntries = Object.entries(category.providers);
  const activeProvider = category.providers[activeProviderId];
  const defaultRef =
    category.defaultProviderId && category.providers[category.defaultProviderId]
      ? `${category.defaultProviderId}/${category.providers[category.defaultProviderId].defaultModel ?? ''}`
      : '';

  const updateProvider = (patch: Partial<Provider>): void => {
    if (!activeProvider) return;
    setCategory(current => ({
      ...current,
      providers: {
        ...current.providers,
        [activeProviderId]: { ...current.providers[activeProviderId], ...patch },
      },
    }));
    setSaveState('idle');
  };

  const nextProviderId = (name: string): string => {
    const base = normalizeOpenClawProviderId(name) || 'custom';
    if (!category.providers[base]) return base;
    let index = 2;
    while (category.providers[`${base}-${index}`]) index += 1;
    return `${base}-${index}`;
  };

  const addProvider = (): void => {
    const name = providerName.trim();
    if (!name) {
      setFormError(i18nService.t('customModelProviderNameRequired'));
      return;
    }
    const id = nextProviderId(name);
    setCategory(current => ({
      ...current,
      providers: {
        ...current.providers,
        [id]: { displayName: name, baseUrl: '', apiKey: '', models: [] },
      },
    }));
    setActiveProviderId(id);
    setProviderDialogOpen(false);
    setProviderName('');
    setFormError('');
    setSaveState('idle');
  };

  const clearGatewayConfiguration = async (): Promise<void> => {
    if (kind === 'speech-recognition') {
      await window.electron.onlineAsr.clearConfiguration();
    } else if (kind === 'speech-synthesis') {
      await window.electron.onlineTts.clearConfiguration();
    } else {
      await window.electron.mediaGenerationModels.saveConfiguration(kind, {
        primary: '',
        fallbacks: [],
      });
    }
  };

  const deleteProvider = (id: string): void => {
    const remaining = Object.fromEntries(providerEntries.filter(([key]) => key !== id));
    if (Object.keys(remaining).length === 0) {
      setSaving(true);
      setSaveState('idle');
      void clearGatewayConfiguration()
        .then(async () => {
          const config = configService.getConfig();
          const all = config.onlineModelProviders ?? {};
          const voice =
            kind === 'speech-recognition'
              ? { ...config.voice, onlineAsrModelRef: '' }
              : kind === 'speech-synthesis'
                ? { ...config.voice, onlineTtsModelRef: '' }
                : config.voice;
          await configService.updateConfig({
            onlineModelProviders: { ...all, [kind]: emptyCategory() },
            voice,
          });
          setCategory(emptyCategory());
          setActiveProviderId('');
          setSaveState('saved');
        })
        .catch(() => setSaveState('error'))
        .finally(() => setSaving(false));
      return;
    }
    setCategory(current => ({
      providers: remaining,
      ...(current.defaultProviderId === id ? {} : { defaultProviderId: current.defaultProviderId }),
    }));
    if (activeProviderId === id) setActiveProviderId(Object.keys(remaining)[0] ?? '');
    setSaveState('idle');
  };

  const openModelDialog = (model?: Provider['models'][number]): void => {
    setModelDialog(model ? { previousId: model.id } : {});
    setModelId(model?.id ?? '');
    setModelName(model?.name ?? '');
    setFormError('');
  };

  const applyModel = (): void => {
    if (!activeProvider) return;
    const id = modelId.trim();
    const name = modelName.trim() || id;
    if (
      !id ||
      activeProvider.models.some(model => model.id === id && model.id !== modelDialog?.previousId)
    ) {
      setFormError(i18nService.t(id ? 'mediaModelAlreadyExists' : 'mediaModelInvalidId'));
      return;
    }
    const models = modelDialog?.previousId
      ? activeProvider.models.map(model =>
          model.id === modelDialog.previousId ? { id, name } : model,
        )
      : [...activeProvider.models, { id, name }];
    const defaultModel =
      activeProvider.defaultModel === modelDialog?.previousId
        ? id
        : (activeProvider.defaultModel ?? (models.length === 1 ? id : undefined));
    updateProvider({ models, defaultModel });
    setModelDialog(null);
  };

  const deleteModel = (id: string): void => {
    if (!activeProvider) return;
    const models = activeProvider.models.filter(model => model.id !== id);
    updateProvider({
      models,
      defaultModel:
        activeProvider.defaultModel === id ? models[0]?.id : activeProvider.defaultModel,
    });
  };

  const setDefaultModel = (id: string): void => {
    updateProvider({ defaultModel: id });
    setCategory(current => ({ ...current, defaultProviderId: activeProviderId }));
  };

  const validationError = useMemo(() => {
    if (!activeProvider) return '';
    if (!activeProvider.displayName.trim()) return i18nService.t('customModelProviderNameRequired');
    try {
      const url = new URL(activeProvider.baseUrl);
      const protocols =
        kind === 'speech-recognition' ? ['http:', 'https:', 'ws:', 'wss:'] : ['http:', 'https:'];
      if (!protocols.includes(url.protocol)) throw new Error();
    } catch {
      return i18nService.t('customModelProviderUrlInvalid');
    }
    if (!activeProvider.defaultModel) return i18nService.t('customModelDefaultRequired');
    if (kind === 'speech-synthesis' && !activeProvider.voice?.trim()) {
      return i18nService.t('customModelVoiceRequired');
    }
    return '';
  }, [activeProvider, kind]);

  const save = async (): Promise<void> => {
    if (!activeProvider || validationError) return;
    setSaving(true);
    setSaveState('idle');
    try {
      const nextCategory = {
        ...category,
        defaultProviderId: category.defaultProviderId ?? activeProviderId,
      };
      const all = configService.getConfig().onlineModelProviders ?? {};
      const provider = nextCategory.providers[nextCategory.defaultProviderId ?? activeProviderId];
      if (!provider?.defaultModel) throw new Error('Default model missing.');
      const common = {
        provider: 'openai',
        baseUrl: provider.baseUrl.trim(),
        apiKey: provider.apiKey.trim() || 'local',
        model: provider.defaultModel,
      };
      if (kind === 'speech-recognition') {
        await window.electron.onlineAsr.saveConfiguration(common);
      } else if (kind === 'speech-synthesis') {
        await window.electron.onlineTts.saveConfiguration({
          ...common,
          voice: provider.voice!.trim(),
        });
      } else {
        await window.electron.mediaGenerationModels.saveConfiguration(kind, {
          primary: `openai/${provider.defaultModel}`,
          fallbacks: [],
          baseUrl: provider.baseUrl.trim(),
          apiKey: provider.apiKey.trim() || 'local',
        });
      }
      await configService.updateConfig({ onlineModelProviders: { ...all, [kind]: nextCategory } });
      setCategory(nextCategory);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'mt-1 block h-9 w-full rounded-xl border border-border-input bg-white px-3 text-xs text-foreground shadow-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 dark:bg-surface';

  return (
    <div className="space-y-4">
      <div className="flex max-w-[980px] items-start gap-5">
        <aside className="w-60 shrink-0 space-y-1.5">
          <div className="mb-2 flex h-8 items-center px-1">
            <h3 className="text-sm font-medium text-foreground">
              {i18nService.t('modelProviders')}
            </h3>
          </div>
          {providerEntries.map(([id, provider]) => (
            <div
              key={id}
              className={`group flex min-h-12 cursor-pointer items-center rounded-xl border p-2 transition-colors ${activeProviderId === id ? 'border-primary/35 bg-primary-muted text-primary' : 'border-transparent bg-surface hover:bg-surface-raised'}`}
              onClick={() => setActiveProviderId(id)}
            >
              <CubeIcon className="mr-2 h-5 w-5 shrink-0 text-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {provider.displayName}
              </span>
              <button
                type="button"
                onClick={event => {
                  event.stopPropagation();
                  deleteProvider(id);
                }}
                aria-label={`${i18nService.t('deleteCustomProvider')}: ${provider.displayName}`}
                className="rounded p-1 text-secondary opacity-0 transition group-hover:opacity-100 hover:text-red-500"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setProviderDialogOpen(true);
              setFormError('');
            }}
            className="mt-2 h-9 w-full rounded-xl border border-dashed border-border px-3 text-xs font-medium text-secondary transition hover:border-primary/50 hover:bg-primary-muted/40 hover:text-primary"
          >
            <PlusIcon className="mr-1 inline h-3.5 w-3.5" />
            {i18nService.t('addCustomProvider')}
          </button>
        </aside>

        <section className="min-h-[360px] min-w-0 flex-1">
          {!activeProvider ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-8 text-center">
              <CubeIcon className="mb-3 h-7 w-7 text-muted" />
              <p className="text-sm font-medium text-secondary">
                {i18nService.t('customModelNoProviders')}
              </p>
              <p className="mt-1 text-xs text-muted">
                {i18nService.t('customModelNoProvidersHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-surface p-3">
                <h3 className="mb-2 text-xs font-semibold text-foreground">
                  {i18nService.t('providerCredentials')}
                </h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="text-xs text-secondary">
                    {i18nService.t('customDisplayName')}
                    <input
                      value={activeProvider.displayName}
                      onChange={event => updateProvider({ displayName: event.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-xs text-secondary">
                    {i18nService.t('baseUrl')}
                    <input
                      value={activeProvider.baseUrl}
                      onChange={event => updateProvider({ baseUrl: event.target.value })}
                      placeholder="http://127.0.0.1:8000/v1"
                      className={inputClass}
                    />
                  </label>
                  <label className="relative text-xs text-secondary">
                    {i18nService.t('apiKey')}
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={activeProvider.apiKey}
                      onChange={event => updateProvider({ apiKey: event.target.value })}
                      autoComplete="off"
                      className={`${inputClass} pr-9`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(value => !value)}
                      aria-label={i18nService.t(
                        showApiKey ? 'voiceOnlineHideApiKey' : 'voiceOnlineShowApiKey',
                      )}
                      className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center text-secondary"
                    >
                      {showApiKey ? (
                        <EyeSlashIcon className="h-4 w-4" />
                      ) : (
                        <EyeIcon className="h-4 w-4" />
                      )}
                    </button>
                  </label>
                  {kind === 'speech-synthesis' ? (
                    <label className="text-xs text-secondary">
                      {i18nService.t('voiceSpeaker')}
                      <input
                        value={activeProvider.voice ?? ''}
                        onChange={event => updateProvider({ voice: event.target.value })}
                        className={inputClass}
                      />
                    </label>
                  ) : null}
                </div>
                <p className="mt-2 text-[10px] text-muted">
                  {i18nService.t(PROTOCOL_HINT_KEYS[kind])}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-foreground">
                    {i18nService.t('availableModels')}
                  </h3>
                  <button
                    type="button"
                    onClick={() => openModelDialog()}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-border-input px-2.5 text-xs text-foreground"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    {i18nService.t('manualAddModel')}
                  </button>
                </div>
                <div className="min-h-[140px] space-y-2">
                  {activeProvider.models.map(model => {
                    const isDefault = defaultRef === `${activeProviderId}/${model.id}`;
                    return (
                      <div
                        key={model.id}
                        className="flex items-center rounded-lg border border-border-subtle bg-background p-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium text-foreground">
                            {model.name}
                          </div>
                          <div className="truncate text-[10px] text-secondary">{model.id}</div>
                        </div>
                        {isDefault ? (
                          <span className="mr-1 rounded-md bg-primary-muted px-1.5 py-0.5 text-[10px] text-primary">
                            {i18nService.t('mediaModelDefaultBadge')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDefaultModel(model.id)}
                            className="mr-1 rounded px-1.5 py-1 text-[10px] text-secondary hover:text-primary"
                          >
                            {i18nService.t('mediaModelSetDefault')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openModelDialog(model)}
                          aria-label={`${i18nService.t('editModel')}: ${model.name}`}
                          className="p-1 text-secondary"
                        >
                          <PencilSquareIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteModel(model.id)}
                          aria-label={`${i18nService.t('deleteModel')}: ${model.name}`}
                          className="p-1 text-secondary hover:text-red-500"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {activeProvider.models.length === 0 ? (
                    <div className="flex min-h-[140px] items-center justify-center rounded-lg bg-surface-raised/40 text-xs text-muted">
                      {i18nService.t('noModelsAvailable')}
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-end gap-3 border-t border-border pt-3">
                  {validationError ? (
                    <span className="mr-auto text-xs text-amber-600">{validationError}</span>
                  ) : null}
                  {saveState !== 'idle' ? (
                    <span
                      className={`text-xs ${saveState === 'error' ? 'text-red-500' : 'text-green-600'}`}
                    >
                      {i18nService.t(
                        saveState === 'error' ? 'mediaModelSaveFailed' : 'mediaModelSaved',
                      )}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    disabled={Boolean(validationError) || saving}
                    onClick={() => void save()}
                    className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
                  >
                    <CheckIcon className="mr-1 inline h-4 w-4" />
                    {i18nService.t(saving ? 'mediaModelSaving' : 'mediaModelSave')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {providerDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl border border-border bg-background p-5"
          >
            <h3 className="text-sm font-semibold">{i18nService.t('addCustomProvider')}</h3>
            <label className="mt-4 block text-xs text-secondary">
              {i18nService.t('customDisplayName')}
              <input
                autoFocus
                value={providerName}
                onChange={event => {
                  setProviderName(event.target.value);
                  setFormError('');
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') addProvider();
                }}
                className={inputClass}
              />
            </label>
            {formError ? <p className="mt-2 text-xs text-red-500">{formError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProviderDialogOpen(false)}
                className="h-9 rounded-lg border border-border px-4 text-sm"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={addProvider}
                className="h-9 rounded-lg bg-primary px-4 text-sm text-white"
              >
                {i18nService.t('confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {modelDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-border bg-background p-5"
          >
            <h3 className="text-sm font-semibold">
              {i18nService.t(modelDialog.previousId ? 'mediaModelEditTitle' : 'mediaModelAddTitle')}
            </h3>
            <div className="mt-4 grid gap-3">
              <label className="text-xs text-secondary">
                {i18nService.t('mediaModelId')}
                <input
                  autoFocus
                  value={modelId}
                  onChange={event => {
                    setModelId(event.target.value);
                    setFormError('');
                  }}
                  className={inputClass}
                />
              </label>
              <label className="text-xs text-secondary">
                {i18nService.t('modelName')}
                <input
                  value={modelName}
                  onChange={event => setModelName(event.target.value)}
                  className={inputClass}
                />
              </label>
            </div>
            {formError ? <p className="mt-2 text-xs text-red-500">{formError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModelDialog(null)}
                className="h-9 rounded-lg border border-border px-4 text-sm"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={applyModel}
                className="h-9 rounded-lg bg-primary px-4 text-sm text-white"
              >
                {i18nService.t('confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CustomOnlineModelSettings;
