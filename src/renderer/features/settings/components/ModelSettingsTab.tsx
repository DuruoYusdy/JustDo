import React from 'react';

import { i18nService } from '@/services/i18n';

import LanguageModelSettings, { type LanguageModelSettingsProps } from './LanguageModelSettings';
import {
  createEmptyNonLanguageModelCategory,
  type NonLanguageModelCategory,
  type NonLanguageModelProviders,
} from './nonLanguageModelConfig';
import NonLanguageModelSettings, { type NonLanguageModelKind } from './NonLanguageModelSettings';

export type ModelKind = 'language' | NonLanguageModelKind;

interface ModelSettingsTabProps {
  languageSettings: LanguageModelSettingsProps;
  nonLanguageSettings: {
    categories: NonLanguageModelProviders;
    setCategory: (
      kind: NonLanguageModelKind,
      update: React.SetStateAction<NonLanguageModelCategory>,
    ) => void;
  };
  activeKind: ModelKind;
  onKindChange: (kind: ModelKind) => void;
}

const ModelSettingsTab: React.FC<ModelSettingsTabProps> = ({
  languageSettings,
  nonLanguageSettings,
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
        {activeKind === 'language' ? <LanguageModelSettings {...languageSettings} /> : null}
        {activeKind !== 'language' ? (
          <NonLanguageModelSettings
            key={activeKind}
            kind={activeKind}
            category={
              nonLanguageSettings.categories[activeKind] ?? createEmptyNonLanguageModelCategory()
            }
            setCategory={update => nonLanguageSettings.setCategory(activeKind, update)}
          />
        ) : null}
      </div>
    </div>
  );
};

export default ModelSettingsTab;
