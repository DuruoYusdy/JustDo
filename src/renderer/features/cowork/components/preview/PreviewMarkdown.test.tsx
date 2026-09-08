// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import PreviewMarkdown from './PreviewMarkdown';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  renderMermaidSvg: vi.fn().mockResolvedValue('<svg data-testid="diagram"></svg>'),
}));

vi.mock('mermaid', () => ({ default: { initialize: mocks.initialize } }));
vi.mock('@/libs/openclaw-chat/components/mermaidRenderer', () => ({
  renderMermaidSvg: mocks.renderMermaidSvg,
}));
vi.mock('@/services/i18n', () => ({
  i18nService: { t: (key: string) => key },
}));

describe('PreviewMarkdown', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'diagram-id' });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test('renders Mermaid blocks', async () => {
    render(
      <PreviewMarkdown
        mermaidIdPrefix="plan"
        html={'<div class="mermaid-block"><div class="mermaid-preview"></div><div class="mermaid-source"><code>graph TD; A--&gt;B</code></div></div>'}
      />,
    );

    await waitFor(() => expect(mocks.renderMermaidSvg).toHaveBeenCalledOnce());
    expect(document.querySelector('[data-testid="diagram"]')).toBeTruthy();
  });

  test('copies fenced code through the shared preview action', async () => {
    render(
      <PreviewMarkdown
        mermaidIdPrefix="plan"
        html={'<button class="code-block-copy" data-code="const value = 1"><span class="code-block-copy__idle"></span><span class="code-block-copy__done"></span></button>'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'copyToClipboard' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const value = 1'));
  });
});
