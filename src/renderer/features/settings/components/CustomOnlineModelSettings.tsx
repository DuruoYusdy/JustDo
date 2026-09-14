import {
  ArrowPathIcon,
  CheckIcon,
  CubeIcon,
  EyeIcon,
  EyeSlashIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { ApiFetchOptions } from '@shared/network';
import { normalizeOpenClawProviderId, validateCustomProviderDisplayName } from '@shared/providers';
import { parseProviderModelsResponse } from '@shared/providers/modelDiscovery';
import React, { useEffect, useRef, useState } from 'react';

import type { AppConfig } from '@/app/config';
import { configService } from '@/services/config';
import { i18nService } from '@/services/i18n';

import {
  buildCustomOnlineEndpointPreview,
  buildCustomOnlineModelsUrl,
  buildCustomOnlineOpenApiUrl,
  buildVoiceDiscoveryUrls,
  type CustomOnlineModelKind,
  normalizeCustomOnlineBaseUrl,
} from './customOnlineModelUrls';

export type { CustomOnlineModelKind } from './customOnlineModelUrls';
export {
  buildCustomOnlineEndpointPreview,
  buildCustomOnlineModelsUrl,
  normalizeCustomOnlineBaseUrl,
} from './customOnlineModelUrls';

type Category = NonNullable<AppConfig['onlineModelProviders']>[CustomOnlineModelKind];
type Provider = NonNullable<Category>['providers'][string];

const emptyCategory = (): NonNullable<Category> => ({ providers: {} });

const PROTOCOL_HINT_KEYS = {
  'speech-recognition': 'customRecognitionProtocolHint',
  'speech-synthesis': 'customSynthesisProtocolHint',
  image: 'customImageProtocolHint',
  video: 'customVideoProtocolHint',
} as const;

const DISCOVERY_TIMEOUT_MS = 10_000;

type DiscoveredVoice = { id: string; name: string };
type DiscoveredModel = { id: string; name: string; voice?: string };
type DetectionRequestsRef = React.MutableRefObject<Set<string>>;

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const trapDialogTab = (event: React.KeyboardEvent<HTMLDivElement>): void => {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(element => !element.hasAttribute('hidden'));
  if (focusable.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }
  const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
  const nextIndex = event.shiftKey
    ? currentIndex <= 0
      ? focusable.length - 1
      : currentIndex - 1
    : currentIndex < 0 || currentIndex === focusable.length - 1
      ? 0
      : currentIndex + 1;
  event.preventDefault();
  focusable[nextIndex]?.focus();
};

const cancelDetectionRequests = (requests: DetectionRequestsRef): void => {
  requests.current.forEach(
    requestId => void window.electron.api.cancelFetch(requestId).catch(() => undefined),
  );
  requests.current.clear();
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const parseDiscoveredVoices = (payload: unknown, modelId: string): DiscoveredVoice[] => {
  const root = toRecord(payload);
  const data = toRecord(root?.data);
  const catalogValues = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    const record = toRecord(value);
    if (!record) return [];
    return Object.entries(record).map(([id, item]) => {
      if (typeof item === 'string') return { id, name: item };
      const itemRecord = toRecord(item);
      return itemRecord ? { id, ...itemRecord } : item;
    });
  };
  const candidates = [
    ...(Array.isArray(payload) ? payload : []),
    ...catalogValues(root?.voices),
    ...(Array.isArray(root?.data) ? root.data : []),
    ...catalogValues(data?.voices),
    ...catalogValues(data?.builtins),
    ...catalogValues(data?.custom),
    ...catalogValues(root?.builtins),
    ...catalogValues(root?.custom),
  ];
  const voices = new Map<string, DiscoveredVoice>();

  const addVoice = (value: unknown): void => {
    if (typeof value === 'string') {
      const id = value.trim();
      if (id) voices.set(id, { id, name: id });
      return;
    }

    const record = toRecord(value);
    if (!record) return;
    const nestedVoices = catalogValues(record.voices);
    if (nestedVoices.length > 0) {
      const nestedModel = String(
        record.model_id ?? record.modelId ?? record.model ?? record.id ?? '',
      );
      if (!nestedModel || nestedModel === modelId) nestedVoices.forEach(addVoice);
      return;
    }

    const supportedModels = [record.model_id, record.modelId, record.model]
      .filter((item): item is string => typeof item === 'string')
      .concat(
        Array.isArray(record.models)
          ? record.models.filter((item): item is string => typeof item === 'string')
          : [],
      );
    if (supportedModels.length > 0 && !supportedModels.includes(modelId)) return;
    const rawId = record.voice_id ?? record.voiceId ?? record.id ?? record.value;
    if (typeof rawId !== 'string' || !rawId.trim()) return;
    const id = rawId.trim();
    const rawName = record.name ?? record.label;
    voices.set(id, {
      id,
      name: typeof rawName === 'string' && rawName.trim() ? rawName.trim() : id,
    });
  };

  candidates.forEach(addVoice);
  return [...voices.values()];
};

const resolveOpenApiSchema = (
  root: Record<string, unknown>,
  value: unknown,
): Record<string, unknown> | null => {
  const schema = toRecord(value);
  const reference = schema?.$ref;
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return schema;
  return reference
    .slice(2)
    .split('/')
    .reduce<unknown>((current, segment) => toRecord(current)?.[decodeURIComponent(segment)], root) as
    | Record<string, unknown>
    | null;
};

export const parseOpenApiDefaultModels = (
  payload: unknown,
  kind: CustomOnlineModelKind,
  endpointUrl: string,
): DiscoveredModel[] => {
  const root = toRecord(payload);
  const paths = toRecord(root?.paths);
  if (!root || !paths) return [];
  let endpointPath = '';
  try {
    endpointPath = new URL(endpointUrl).pathname;
  } catch {
    return [];
  }
  const operation = toRecord(toRecord(paths[endpointPath])?.post);
  const content = toRecord(toRecord(operation?.requestBody)?.content);
  const mediaType = toRecord(content?.['application/json']);
  const schema = resolveOpenApiSchema(root, mediaType?.schema);
  const properties = toRecord(schema?.properties);
  const modelSchema = resolveOpenApiSchema(root, properties?.model);
  const voiceSchema = resolveOpenApiSchema(root, properties?.voice);
  const modelValues = Array.isArray(modelSchema?.enum)
    ? modelSchema.enum
    : modelSchema?.default !== undefined
      ? [modelSchema.default]
      : [];
  const voice =
    kind === 'speech-synthesis' && typeof voiceSchema?.default === 'string'
      ? voiceSchema.default.trim()
      : '';
  return modelValues
    .filter((model): model is string => typeof model === 'string' && Boolean(model.trim()))
    .map(model => ({
      id: model.trim(),
      name: model.trim(),
      ...(voice ? { voice } : {}),
    }));
};

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
  const [modelVoice, setModelVoice] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [formError, setFormError] = useState('');
  const [detectingModels, setDetectingModels] = useState(false);
  const [detectionMessage, setDetectionMessage] = useState('');
  const [detectedVoices, setDetectedVoices] = useState<DiscoveredVoice[]>([]);
  const [detectingVoices, setDetectingVoices] = useState(false);
  const [voiceDetectionMessage, setVoiceDetectionMessage] = useState('');
  const modelDetectionGenerationRef = useRef(0);
  const voiceDetectionGenerationRef = useRef(0);
  const modelDetectionRequestsRef = useRef(new Set<string>());
  const voiceDetectionRequestsRef = useRef(new Set<string>());
  const providerDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const modelDialogReturnFocusRef = useRef<HTMLElement | null>(null);

  const fetchWithDiscoveryTimeout = async (
    options: Omit<ApiFetchOptions, 'requestId'>,
    requests: DetectionRequestsRef,
  ) => {
    const requestId = `custom-model-discovery-${crypto.randomUUID()}`;
    requests.current.add(requestId);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        window.electron.api.fetch({ ...options, requestId }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            void window.electron.api.cancelFetch(requestId).catch(() => undefined);
            reject(new Error(i18nService.t('customModelDetectionTimeout')));
          }, DISCOVERY_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      requests.current.delete(requestId);
    }
  };

  useEffect(
    () => () => {
      modelDetectionGenerationRef.current += 1;
      voiceDetectionGenerationRef.current += 1;
      cancelDetectionRequests(modelDetectionRequestsRef);
      cancelDetectionRequests(voiceDetectionRequestsRef);
    },
    [],
  );

  const invalidateModelDetection = (): void => {
    modelDetectionGenerationRef.current += 1;
    cancelDetectionRequests(modelDetectionRequestsRef);
    setDetectingModels(false);
  };

  const invalidateVoiceDetection = (): void => {
    voiceDetectionGenerationRef.current += 1;
    cancelDetectionRequests(voiceDetectionRequestsRef);
    setDetectingVoices(false);
  };

  const restoreDialogFocus = (target: HTMLElement | null): void => {
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
    });
  };

  const closeProviderDialog = (): void => {
    setProviderDialogOpen(false);
    restoreDialogFocus(providerDialogReturnFocusRef.current);
  };

  const closeModelDialog = (): void => {
    invalidateVoiceDetection();
    setModelDialog(null);
    restoreDialogFocus(modelDialogReturnFocusRef.current);
  };

  const providerEntries = Object.entries(category.providers);
  const activeProvider = category.providers[activeProviderId];
  const defaultRef =
    category.defaultProviderId && category.providers[category.defaultProviderId]
      ? `${category.defaultProviderId}/${category.providers[category.defaultProviderId].defaultModel ?? ''}`
      : '';
  const endpointPreview = activeProvider
    ? buildCustomOnlineEndpointPreview(kind, activeProvider.baseUrl)
    : '';

  const providerNameError = (name: string, currentId?: string): string => {
    const validation = validateCustomProviderDisplayName(name);
    if (!validation.valid) {
      return i18nService.t(
        validation.reason === 'reserved' ? 'providerNameReserved' : 'providerNameInvalid',
      );
    }
    const normalized = normalizeOpenClawProviderId(name);
    const duplicate = Object.entries(category.providers).some(
      ([id, provider]) =>
        id !== currentId && normalizeOpenClawProviderId(provider.displayName) === normalized,
    );
    return duplicate ? i18nService.t('providerNameExists') : '';
  };

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
    const nameError = providerNameError(name);
    if (nameError) {
      setFormError(nameError);
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
    closeProviderDialog();
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
    invalidateModelDetection();
    invalidateVoiceDetection();
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
    invalidateVoiceDetection();
    modelDialogReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setModelDialog(model ? { previousId: model.id } : {});
    setModelId(model?.id ?? '');
    setModelName(model?.name ?? '');
    setModelVoice(model?.voice ?? '');
    setDetectedVoices([]);
    setVoiceDetectionMessage('');
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
    if (kind === 'speech-synthesis' && !modelVoice.trim()) {
      setFormError(i18nService.t('customModelVoiceRequired'));
      return;
    }
    const nextModel = {
      id,
      name,
      ...(kind === 'speech-synthesis' ? { voice: modelVoice.trim() } : {}),
    };
    const models = modelDialog?.previousId
      ? activeProvider.models.map(model =>
          model.id === modelDialog.previousId ? nextModel : model,
        )
      : [...activeProvider.models, nextModel];
    const defaultModel =
      activeProvider.defaultModel === modelDialog?.previousId
        ? id
        : (activeProvider.defaultModel ?? (models.length === 1 ? id : undefined));
    updateProvider({ models, defaultModel });
    closeModelDialog();
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

  const detectModels = async (): Promise<void> => {
    if (!activeProvider?.baseUrl.trim() || detectingModels) return;
    const generation = ++modelDetectionGenerationRef.current;
    const providerId = activeProviderId;
    const baseUrl = activeProvider.baseUrl;
    const apiKey = activeProvider.apiKey;
    setDetectingModels(true);
    setDetectionMessage('');
    try {
      const headers: Record<string, string> = apiKey.trim()
        ? { Authorization: `Bearer ${apiKey.trim()}` }
        : {};
      let discovered: DiscoveredModel[] = [];
      let receivedValidResponse = false;
      let lastError = '';
      try {
        const response = await fetchWithDiscoveryTimeout(
          { url: buildCustomOnlineModelsUrl(kind, baseUrl), method: 'GET', headers },
          modelDetectionRequestsRef,
        );
        if (generation !== modelDetectionGenerationRef.current) return;
        if (response.ok) {
          receivedValidResponse = true;
          discovered = parseProviderModelsResponse(response.data);
        } else {
          lastError = `${response.status} ${response.statusText}`.trim();
        }
      } catch (error) {
        if (generation !== modelDetectionGenerationRef.current) return;
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (discovered.length === 0) {
        try {
          const response = await fetchWithDiscoveryTimeout(
            { url: buildCustomOnlineOpenApiUrl(kind, baseUrl), method: 'GET', headers },
            modelDetectionRequestsRef,
          );
          if (generation !== modelDetectionGenerationRef.current) return;
          if (response.ok) {
            receivedValidResponse = true;
            discovered = parseOpenApiDefaultModels(
              response.data,
              kind,
              buildCustomOnlineEndpointPreview(kind, baseUrl),
            );
          } else {
            lastError = `${response.status} ${response.statusText}`.trim();
          }
        } catch (error) {
          if (generation !== modelDetectionGenerationRef.current) return;
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (!receivedValidResponse) throw new Error(lastError);
      setCategory(current => {
        const provider = current.providers[providerId];
        if (provider?.baseUrl !== baseUrl || provider.apiKey !== apiKey) return current;
        const existingIds = new Set(provider.models.map(model => model.id));
        const discoveredById = new Map(discovered.map(model => [model.id, model]));
        return {
          ...current,
          providers: {
            ...current.providers,
            [providerId]: {
              ...provider,
              models: [
                ...provider.models.map(model => {
                  const found = discoveredById.get(model.id);
                  return found?.voice && !model.voice?.trim()
                    ? { ...model, voice: found.voice }
                    : model;
                }),
                ...discovered
                  .filter(model => !existingIds.has(model.id))
                  .map(model => ({
                    id: model.id,
                    name: model.name,
                    ...(model.voice ? { voice: model.voice } : {}),
                  })),
              ],
            },
          },
        };
      });
      setSaveState('idle');
      setDetectionMessage(
        i18nService
          .t(discovered.length ? 'modelDetectionSummarySimple' : 'noModelsDetected')
          .replace('{count}', String(discovered.length)),
      );
    } catch (error) {
      if (generation === modelDetectionGenerationRef.current) {
        const detail = error instanceof Error ? error.message : String(error);
        setDetectionMessage(`${i18nService.t('modelDetectionFailed')}: ${detail}`);
      }
    } finally {
      if (generation === modelDetectionGenerationRef.current) setDetectingModels(false);
    }
  };

  const detectVoices = async (): Promise<void> => {
    if (!activeProvider?.baseUrl.trim() || !modelId.trim() || detectingVoices) return;
    const generation = ++voiceDetectionGenerationRef.current;
    const providerId = activeProviderId;
    const baseUrl = activeProvider.baseUrl;
    const apiKey = activeProvider.apiKey;
    const detectingModelId = modelId.trim();
    setDetectingVoices(true);
    setVoiceDetectionMessage('');
    const headers: Record<string, string> = apiKey.trim()
      ? { Authorization: `Bearer ${apiKey.trim()}` }
      : {};
    let receivedValidResponse = false;
    let lastError = '';
    try {
      for (const url of buildVoiceDiscoveryUrls(baseUrl)) {
        try {
          const response = await fetchWithDiscoveryTimeout(
            { url, method: 'GET', headers },
            voiceDetectionRequestsRef,
          );
          if (
            generation !== voiceDetectionGenerationRef.current ||
            providerId !== activeProviderId ||
            detectingModelId !== modelId.trim()
          ) {
            return;
          }
          if (!response.ok) {
            lastError = `${response.status} ${response.statusText}`.trim();
            continue;
          }
          receivedValidResponse = true;
          const voices = parseDiscoveredVoices(response.data, detectingModelId);
          if (voices.length === 0) continue;
          setDetectedVoices(voices);
          setVoiceDetectionMessage(
            i18nService.t('voiceDetectionSummary').replace('{count}', String(voices.length)),
          );
          return;
        } catch (error) {
          if (generation !== voiceDetectionGenerationRef.current) return;
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      setDetectedVoices([]);
      setVoiceDetectionMessage(
        receivedValidResponse
          ? i18nService.t('noVoicesDetected')
          : `${i18nService.t('voiceDetectionFailed')}${lastError ? `: ${lastError}` : ''}`,
      );
    } finally {
      if (generation === voiceDetectionGenerationRef.current) setDetectingVoices(false);
    }
  };

  const getProviderValidationError = (provider: Provider, providerId: string): string => {
    if (!provider.displayName.trim()) return i18nService.t('customModelProviderNameRequired');
    const nameError = providerNameError(provider.displayName, providerId);
    if (nameError) return nameError;
    try {
      const url = new URL(normalizeCustomOnlineBaseUrl(kind, provider.baseUrl));
      const protocols =
        kind === 'speech-recognition' ? ['http:', 'https:', 'ws:', 'wss:'] : ['http:', 'https:'];
      if (!protocols.includes(url.protocol) || url.username || url.password) throw new Error();
    } catch {
      return i18nService.t('customModelProviderUrlInvalid');
    }
    if (!provider.defaultModel) return i18nService.t('customModelDefaultRequired');
    const defaultModel = provider.models.find(model => model.id === provider.defaultModel);
    if (!defaultModel) return i18nService.t('customModelDefaultRequired');
    if (kind === 'speech-synthesis' && !defaultModel?.voice?.trim()) {
      return i18nService.t('customModelVoiceRequired');
    }
    return '';
  };

  const validationError = (() => {
    if (!activeProvider) return '';
    const activeError = getProviderValidationError(activeProvider, activeProviderId);
    if (activeError) return activeError;
    for (const [providerId, provider] of Object.entries(category.providers)) {
      if (providerId === activeProviderId) continue;
      const error = getProviderValidationError(provider, providerId);
      if (error) {
        return i18nService
          .t('customModelProviderInvalid')
          .replace('{provider}', provider.displayName || providerId)
          .replace('{error}', error);
      }
    }
    return '';
  })();

  const save = async (): Promise<void> => {
    if (!activeProvider || validationError) return;
    setSaving(true);
    setSaveState('idle');
    try {
      const nextCategory = {
        ...category,
        providers: Object.fromEntries(
          Object.entries(category.providers).map(([id, provider]) => [
            id,
            {
              ...provider,
              baseUrl: normalizeCustomOnlineBaseUrl(kind, provider.baseUrl),
            },
          ]),
        ),
        defaultProviderId: category.defaultProviderId ?? activeProviderId,
      };
      const all = configService.getConfig().onlineModelProviders ?? {};
      const provider = nextCategory.providers[nextCategory.defaultProviderId ?? activeProviderId];
      if (!provider?.defaultModel) throw new Error('Default model missing.');
      const common = {
        provider: 'openai',
        baseUrl: normalizeCustomOnlineBaseUrl(kind, provider.baseUrl),
        apiKey: provider.apiKey.trim() || 'local',
        model: provider.defaultModel,
      };
      if (kind === 'speech-recognition') {
        await window.electron.onlineAsr.saveConfiguration(common);
      } else if (kind === 'speech-synthesis') {
        const selectedModel = provider.models.find(model => model.id === provider.defaultModel);
        const voice = selectedModel?.voice?.trim();
        if (!voice) throw new Error('Default speech synthesis model voice missing.');
        await window.electron.onlineTts.saveConfiguration({
          ...common,
          voice,
        });
      } else {
        await window.electron.mediaGenerationModels.saveConfiguration(kind, {
          primary: `openai/${provider.defaultModel}`,
          fallbacks: [],
          baseUrl: normalizeCustomOnlineBaseUrl(kind, provider.baseUrl),
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
      <div className="mx-auto flex w-full max-w-[980px] items-start gap-5">
        <aside className="w-60 shrink-0 space-y-1.5">
          <div className="mb-2 flex h-8 items-center px-1">
            <h3 className="text-sm font-medium text-foreground">
              {i18nService.t('modelProviders')}
            </h3>
          </div>
          {providerEntries.map(([id, provider]) => (
            <div
              key={id}
              className={`group flex min-h-12 items-center rounded-xl border transition-colors ${activeProviderId === id ? 'border-primary/35 bg-primary-muted text-primary' : 'border-transparent bg-surface hover:bg-surface-raised'}`}
            >
              <button
                type="button"
                aria-pressed={activeProviderId === id}
                onClick={() => {
                  invalidateModelDetection();
                  invalidateVoiceDetection();
                  setActiveProviderId(id);
                  setDetectionMessage('');
                }}
                className="flex min-w-0 flex-1 items-center self-stretch p-2 text-left"
              >
                <CubeIcon className="mr-2 h-5 w-5 shrink-0 text-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {provider.displayName}
                </span>
              </button>
              <button
                type="button"
                onClick={() => deleteProvider(id)}
                aria-label={`${i18nService.t('deleteCustomProvider')}: ${provider.displayName}`}
                className="mr-2 rounded p-1 text-secondary opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-red-500"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              providerDialogReturnFocusRef.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
                      onChange={event => {
                        updateProvider({ displayName: event.target.value });
                        setFormError('');
                      }}
                      aria-invalid={Boolean(
                        providerNameError(activeProvider.displayName, activeProviderId),
                      )}
                      className={inputClass}
                    />
                  </label>
                  <div className="text-xs text-secondary">
                    <label htmlFor={`${activeProviderId}-base-url`}>
                      {i18nService.t('baseUrl')}
                    </label>
                    <input
                      id={`${activeProviderId}-base-url`}
                      aria-describedby={`${activeProviderId}-endpoint-preview`}
                      value={activeProvider.baseUrl}
                      onChange={event => {
                        invalidateModelDetection();
                        invalidateVoiceDetection();
                        updateProvider({ baseUrl: event.target.value });
                        setDetectionMessage('');
                      }}
                      placeholder="http://127.0.0.1:8000/v1"
                      className={inputClass}
                    />
                    <span
                      id={`${activeProviderId}-endpoint-preview`}
                      className={`mt-1 block min-h-[14px] truncate font-mono text-[10px] text-muted ${endpointPreview ? '' : 'invisible'}`}
                      title={endpointPreview || undefined}
                    >
                      {endpointPreview || '\u00a0'}
                    </span>
                  </div>
                  <label className="relative text-xs text-secondary">
                    {i18nService.t('apiKey')}
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={activeProvider.apiKey}
                      onChange={event => {
                        invalidateModelDetection();
                        invalidateVoiceDetection();
                        updateProvider({ apiKey: event.target.value });
                      }}
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void detectModels()}
                      disabled={!activeProvider.baseUrl.trim() || detectingModels}
                      aria-describedby={
                        activeProvider.baseUrl.trim()
                          ? undefined
                          : `${activeProviderId}-model-detection-help`
                      }
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border-input px-2.5 text-xs text-foreground disabled:opacity-50"
                    >
                      {detectingModels ? (
                        <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MagnifyingGlassIcon className="h-3.5 w-3.5" />
                      )}
                      {i18nService.t(detectingModels ? 'detectingModels' : 'detectModels')}
                    </button>
                    <button
                      type="button"
                      onClick={() => openModelDialog()}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border-input px-2.5 text-xs text-foreground"
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      {i18nService.t('manualAddModel')}
                    </button>
                  </div>
                </div>
                {!activeProvider.baseUrl.trim() ? (
                  <p
                    id={`${activeProviderId}-model-detection-help`}
                    className="mb-2 text-[10px] text-muted"
                  >
                    {i18nService.t('modelDetectionRequiresBaseUrl')}
                  </p>
                ) : null}
                {detectionMessage ? (
                  <p className="mb-2 text-xs text-secondary" role="status">
                    {detectionMessage}
                  </p>
                ) : null}
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
                          {kind === 'speech-synthesis' && model.voice ? (
                            <div className="truncate text-[10px] text-muted">
                              {i18nService.t('voiceSpeaker')}: {model.voice}
                            </div>
                          ) : null}
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
            aria-labelledby="custom-provider-dialog-title"
            tabIndex={-1}
            className="w-full max-w-sm rounded-2xl border border-border bg-background p-5"
            onKeyDown={event => {
              if (event.key === 'Escape') closeProviderDialog();
              else trapDialogTab(event);
            }}
          >
            <h3 id="custom-provider-dialog-title" className="text-sm font-semibold">
              {i18nService.t('addCustomProvider')}
            </h3>
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
                onClick={closeProviderDialog}
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
            aria-labelledby="custom-model-dialog-title"
            tabIndex={-1}
            className="w-full max-w-md rounded-2xl border border-border bg-background p-5"
            onKeyDown={event => {
              if (event.key === 'Escape') closeModelDialog();
              else trapDialogTab(event);
            }}
          >
            <h3 id="custom-model-dialog-title" className="text-sm font-semibold">
              {i18nService.t(modelDialog.previousId ? 'mediaModelEditTitle' : 'mediaModelAddTitle')}
            </h3>
            <div className="mt-4 grid gap-3">
              <label className="text-xs text-secondary">
                {i18nService.t('mediaModelId')}
                <input
                  autoFocus
                  value={modelId}
                  onChange={event => {
                    invalidateVoiceDetection();
                    setModelId(event.target.value);
                    setDetectedVoices([]);
                    setVoiceDetectionMessage('');
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
              {kind === 'speech-synthesis' ? (
                <div className="text-xs text-secondary">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="custom-online-model-voice">
                      {i18nService.t('voiceSpeaker')}
                    </label>
                    <button
                      type="button"
                      onClick={() => void detectVoices()}
                      disabled={
                        !activeProvider?.baseUrl.trim() || !modelId.trim() || detectingVoices
                      }
                      title={
                        !activeProvider?.baseUrl.trim()
                          ? i18nService.t('modelDetectionRequiresBaseUrl')
                          : !modelId.trim()
                            ? i18nService.t('voiceDetectionRequiresModel')
                            : undefined
                      }
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-border-input px-2 text-[11px] text-foreground disabled:opacity-50"
                    >
                      {detectingVoices ? (
                        <ArrowPathIcon className="h-3 w-3 animate-spin" />
                      ) : (
                        <MagnifyingGlassIcon className="h-3 w-3" />
                      )}
                      {i18nService.t(detectingVoices ? 'detectingVoices' : 'detectVoices')}
                    </button>
                  </div>
                  <input
                    id="custom-online-model-voice"
                    list="custom-online-model-voice-options"
                    value={modelVoice}
                    onChange={event => {
                      setModelVoice(event.target.value);
                      setFormError('');
                    }}
                    className={inputClass}
                  />
                  <datalist id="custom-online-model-voice-options">
                    {detectedVoices.map(voice => (
                      <option key={voice.id} value={voice.id} label={voice.name} />
                    ))}
                  </datalist>
                  {voiceDetectionMessage ? (
                    <p className="mt-1 text-[10px] text-muted" role="status">
                      {voiceDetectionMessage}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] text-muted">
                      {i18nService.t('customVoiceDetectionHint')}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            {formError ? <p className="mt-2 text-xs text-red-500">{formError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModelDialog}
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
