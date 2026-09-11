// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UnifiedModelSettingsTab from './UnifiedModelSettingsTab';

vi.mock('@/services/i18n', () => ({
  i18nService: { t: (key: string) => key },
}));

vi.mock('./CustomOnlineModelSettings', () => ({
  default: ({ kind }: { kind: string }) => <div data-testid="custom-panel">{`custom-${kind}`}</div>,
}));

afterEach(cleanup);

describe('UnifiedModelSettingsTab', () => {
  it('keeps the existing language model interface as the default panel', () => {
    render(
      <UnifiedModelSettingsTab
        activeKind="language"
        onKindChange={vi.fn()}
        languageModels={<div>existing-language-model-settings</div>}
      />,
    );

    expect(screen.getByText('existing-language-model-settings')).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: 'modelTypeLanguage' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('requests a model category change from the tab bar', () => {
    const onKindChange = vi.fn();
    render(
      <UnifiedModelSettingsTab
        activeKind="language"
        onKindChange={onKindChange}
        languageModels={<div>language</div>}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'modelTypeSpeechRecognition' }));
    expect(onKindChange).toHaveBeenCalledWith('speech-recognition');
  });

  it('offers image and video generation categories', () => {
    const onKindChange = vi.fn();
    render(
      <UnifiedModelSettingsTab
        activeKind="video"
        onKindChange={onKindChange}
        languageModels={<div>language</div>}
      />,
    );

    expect(screen.getByText('custom-video')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'modelTypeImage' }));
    expect(onKindChange).toHaveBeenCalledWith('image');
  });

  it('remounts custom settings when the model category changes', () => {
    const { rerender } = render(
      <UnifiedModelSettingsTab
        activeKind="speech-recognition"
        onKindChange={vi.fn()}
        languageModels={<div>language</div>}
      />,
    );
    const recognitionPanel = screen.getByTestId('custom-panel');

    rerender(
      <UnifiedModelSettingsTab
        activeKind="image"
        onKindChange={vi.fn()}
        languageModels={<div>language</div>}
      />,
    );

    expect(screen.getByTestId('custom-panel')).not.toBe(recognitionPanel);
    expect(screen.getByText('custom-image')).toBeTruthy();
  });
});
