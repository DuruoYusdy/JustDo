// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { currentConfig, updateConfig } = vi.hoisted(() => ({
  currentConfig: { onlineModelProviders: {}, voice: {} } as Record<string, unknown>,
  updateConfig: vi.fn(),
}));

vi.mock('@/services/config', () => ({
  configService: {
    getConfig: () => currentConfig,
    updateConfig,
  },
}));

vi.mock('@/services/i18n', () => ({
  i18nService: { t: (key: string) => key },
}));

import CustomOnlineModelSettings from './CustomOnlineModelSettings';

afterEach(cleanup);

describe('CustomOnlineModelSettings', () => {
  const saveConfiguration = vi.fn();

  beforeEach(() => {
    updateConfig.mockReset().mockResolvedValue(undefined);
    currentConfig.onlineModelProviders = {};
    currentConfig.voice = {};
    saveConfiguration.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        onlineAsr: { saveConfiguration, clearConfiguration: vi.fn().mockResolvedValue(undefined) },
        onlineTts: {
          saveConfiguration: vi.fn(),
          clearConfiguration: vi.fn().mockResolvedValue(undefined),
        },
        mediaGenerationModels: { saveConfiguration: vi.fn() },
      },
    });
  });

  it('starts empty and lets the user create a provider and its models', async () => {
    render(<CustomOnlineModelSettings kind="speech-recognition" />);

    expect(screen.getByText('customModelNoProviders')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /addCustomProvider/ }));
    fireEvent.change(screen.getByLabelText('customDisplayName'), {
      target: { value: 'Office Speech' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'confirm' }));

    fireEvent.change(screen.getByLabelText('baseUrl'), {
      target: { value: 'http://speech.lan/v1' },
    });
    fireEvent.change(screen.getByLabelText('apiKey'), { target: { value: 'local-key' } });
    fireEvent.click(screen.getByRole('button', { name: /manualAddModel/ }));
    fireEvent.change(screen.getByLabelText('mediaModelId'), {
      target: { value: 'whisper-local' },
    });
    fireEvent.change(screen.getByLabelText('modelName'), {
      target: { value: 'Whisper Local' },
    });
    const confirmButtons = screen.getAllByRole('button', { name: 'confirm' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    fireEvent.click(screen.getByRole('button', { name: 'mediaModelSetDefault' }));
    fireEvent.click(screen.getByRole('button', { name: /mediaModelSave/ }));

    await waitFor(() =>
      expect(saveConfiguration).toHaveBeenCalledWith({
        provider: 'openai',
        baseUrl: 'http://speech.lan/v1',
        apiKey: 'local-key',
        model: 'whisper-local',
      }),
    );
    expect(updateConfig).toHaveBeenCalled();
  });

  it('persists and clears Gateway state when the last provider is deleted', async () => {
    currentConfig.onlineModelProviders = {
      'speech-recognition': {
        defaultProviderId: 'office',
        providers: {
          office: {
            displayName: 'Office Speech',
            baseUrl: 'http://speech.lan/v1',
            apiKey: 'key',
            defaultModel: 'whisper',
            models: [{ id: 'whisper', name: 'Whisper' }],
          },
        },
      },
    };

    render(<CustomOnlineModelSettings kind="speech-recognition" />);
    fireEvent.click(screen.getByRole('button', { name: 'deleteCustomProvider: Office Speech' }));

    await waitFor(() => expect(window.electron.onlineAsr.clearConfiguration).toHaveBeenCalled());
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        onlineModelProviders: expect.objectContaining({
          'speech-recognition': { providers: {} },
        }),
      }),
    );
    expect(screen.getByText('customModelNoProviders')).toBeTruthy();
  });
});
