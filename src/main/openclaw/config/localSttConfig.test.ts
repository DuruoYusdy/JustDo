import { describe, expect, it, vi } from 'vitest';

import { defaultLocalSpeechSettings } from '../../../shared/speech/localSpeechSettings';
import { getLocalAsrStatus } from '../../speech/localAsrService';
import { buildManagedLocalSttConfig } from './localSttConfig';
import { mergeOpenClawPluginConfig } from './openclawConfigSync';
vi.mock('../../speech/localAsrService', async importOriginal => ({
  ...await importOriginal<typeof import('../../speech/localAsrService')>(),
  getLocalAsrStatus: vi.fn().mockReturnValue({ available: true }),
}));
const paths = { executablePath: 'C:\\runtime\\sherpa.exe', modelDir: 'C:\\models\\中文', modelId: defaultLocalSpeechSettings.asrModelId };
describe('local STT configuration', () => {
  it('reuses local models and language even when microphone input is disabled', () => {
    const config = buildManagedLocalSttConfig(defaultLocalSpeechSettings, 'zh', paths);
    expect(config).toMatchObject({ command: paths.executablePath, modelId: paths.modelId, language: 'zh' });
    expect(config?.args).toContain('--sense-voice-language=zh');
    expect(config?.args).toContain('--num-threads=2');
  });
  it('does not advertise a missing model', () => {
    vi.mocked(getLocalAsrStatus).mockReturnValueOnce({ available: false, supported: true, modelId: paths.modelId });
    expect(buildManagedLocalSttConfig(defaultLocalSpeechSettings, 'en', paths)).toBeNull();
  });
  it.each(['stt-local-cli', 'tts-local-cli'])('preserves an explicitly disabled %s plugin', pluginId => {
    const merged = mergeOpenClawPluginConfig({ entries: { [pluginId]: { enabled: false, config: { command: 'old' } } } }, { [pluginId]: { enabled: true, config: { command: 'new' } } });
    expect(merged.entries).toMatchObject({ [pluginId]: { enabled: false, config: { command: 'new' } } });
  });
});
