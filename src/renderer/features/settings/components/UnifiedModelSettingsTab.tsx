import React from 'react';

import { i18nService } from '@/services/i18n';

import CustomOnlineModelSettings from './CustomOnlineModelSettings';

export type ModelKind = 'language' | 'speech-recognition' | 'speech-synthesis' | 'image' | 'video';

interface UnifiedModelSettingsTabProps {
  languageModels: React.ReactNode;
  activeKind: ModelKind;
  onKindChange: (kind: ModelKind) => void;
}

const UnifiedModelSettingsTab: React.FC<UnifiedModelSettingsTabProps> = ({
  languageModels,
  activeKind,
  onKindChange,
}) => {
  const kinds: Array<{ id: ModelKind; label: string }> = [
    {
      id: 'language',
      label: i18nService.t('modelTypeLanguage'),
    },
    {
      id: 'speech-recognition',
      label: i18nService.t('modelTypeSpeechRecognition'),
    },
    {
      id: 'speech-synthesis',
      label: i18nService.t('modelTypeSpeechSynthesis'),
    },
    {
      id: 'image',
      label: i18nService.t('modelTypeImage'),
    },
    {
      id: 'video',
      label: i18nService.t('modelTypeVideo'),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto border-b border-border" role="tablist">
        <div className="flex w-max min-w-full justify-center gap-1">
          {kinds.map(kind => (
            <button
              key={kind.id}
              type="button"
              role="tab"
              aria-selected={activeKind === kind.id}
              onClick={() => onKindChange(kind.id)}
              className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeKind === kind.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-secondary hover:text-foreground'
              }`}
            >
              {kind.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel">
        {activeKind === 'language' ? languageModels : null}
        {activeKind !== 'language' ? (
          <CustomOnlineModelSettings key={activeKind} kind={activeKind} />
        ) : null}
      </div>
    </div>
  );
};

export default UnifiedModelSettingsTab;
