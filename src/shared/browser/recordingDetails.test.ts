import { describe, expect, it } from 'vitest';

import {
  type BrowserRecordingDraft,
  parseRecordingContext,
  parseRecordingEvent,
  serializeRecording,
} from './browserRecording';
import { parseElementDetails, parseInteraction } from './recordingDetails';

describe('recording evidence transport', () => {
  const target = {
    tag: 'button',
    name: 'Save',
    role: 'button',
    selector: '#save',
    html: '<button>Save</button>',
    locators: [{ kind: 'css' as const, value: '#save', matches: 1, verified: true }],
    state: { disabled: false },
  };
  const draft: BrowserRecordingDraft = {
    id: 'r',
    sessionId: 's',
    title: '',
    note: '',
    startedAt: 0,
    profile: 'embedded',
    images: [],
    steps: [
      {
        id: '1',
        pageId: 'p',
        action: 'click',
        at: 0,
        title: '',
        url: 'https://example.com',
        target,
        interaction: { observed: { state: { expanded: 'true' }, messages: ['Done'] } },
      },
    ],
  };
  it('preserves all evidence through event parsing and message roundtrip', () => {
    const event = parseRecordingEvent({
      ...draft.steps[0],
      recordingId: 'r',
      documentId: 'doc',
      sequence: 1,
    });
    expect(event?.target?.locators).toEqual(target.locators);
    const parsed = parseRecordingContext(serializeRecording(draft));
    expect(parsed?.steps[0].target?.state).toEqual({ disabled: false });
    expect(parsed?.steps[0].interaction?.observed?.messages).toEqual(['Done']);
  });
  it('rejects invalid selectors, nonfinite coordinates and unknown state keys', () => {
    expect(
      parseElementDetails({
        locators: [{ kind: 'css', value: 'x'.repeat(1001), matches: 1 }],
        state: { evil: 'bad', checked: true },
        bounds: { x: Infinity, y: 0, width: 1, height: 2 },
      }),
    ).toEqual({ locators: [], state: { checked: true } });
    expect(parseInteraction({ pointer: { x: NaN }, modifiers: ['Control', 'evil'] })).toEqual({
      modifiers: ['Control'],
    });
  });
  it('strips every added detail on password-marked events and message steps', () => {
    const secretTarget = {
      ...target,
      name: 'secret',
      html: 'secret',
      state: { value: 'secret' },
      attributes: { title: 'secret' },
    };
    const secretStep = {
      ...draft.steps[0],
      target: secretTarget,
      sensitive: true,
      value: 'secret',
      interaction: { observed: { messages: ['secret'] } },
    };
    const event = parseRecordingEvent({
      ...secretStep,
      recordingId: 'r',
      documentId: 'doc',
      sequence: 1,
    });
    expect(JSON.stringify(event)).not.toContain('secret');
    const text = serializeRecording({ ...draft, steps: [secretStep] });
    expect(text).not.toContain('secret');
    expect(parseRecordingContext(text)?.steps[0].interaction).toBeUndefined();
  });
  it('deduplicates repeated evidence while retaining every step', () => {
    const repeated = { ...target, html: '<button>' + 'a'.repeat(4000) + '</button>' };
    const text = serializeRecording({
      ...draft,
      steps: Array.from({ length: 20 }, (_, i) => ({
        ...draft.steps[0],
        id: String(i),
        target: repeated,
      })),
    });
    expect(JSON.parse(text).targets).toHaveLength(1);
    expect(parseRecordingContext(text)?.steps).toHaveLength(20);
    expect(parseRecordingContext(text)?.steps[19].target?.html).toBe(repeated.html);
  });
  it('drops optional HTML with an explicit marker before hitting the message budget', () => {
    const text = serializeRecording({
      ...draft,
      steps: Array.from({ length: 20 }, (_, i) => ({
        ...draft.steps[0],
        id: String(i),
        target: { ...target, name: String(i), html: '<button>' + 'a'.repeat(4000) + '</button>' },
      })),
    });
    expect(text.length).toBeLessThanOrEqual(64000);
    expect(JSON.parse(text).detailLimited).toBe(true);
    expect(parseRecordingContext(text)?.steps[0].target?.limitations).toContain('context-budget');
    expect(parseRecordingContext(text)?.steps[0].target?.locators).toEqual(target.locators);
  });
});
