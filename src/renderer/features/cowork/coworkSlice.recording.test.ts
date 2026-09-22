import type { BrowserRecordingDraft } from '@shared/browser/browserRecording';
import { describe, expect, it } from 'vitest';

import reducer, { removeDraftBrowserRecording, setDraftBrowserRecording } from './coworkSlice';

const draft: BrowserRecordingDraft = {
  id: 'recording',
  sessionId: 'session',
  profile: 'embedded',
  title: 'Original',
  note: '',
  startedAt: 0,
  steps: [],
  images: [],
};

describe('recording draft submission ownership', () => {
  it('keeps a same-id recording saved while its previous version was sending', () => {
    const pending = reducer(
      undefined,
      setDraftBrowserRecording({ draftKey: 'session', recording: draft }),
    );
    const submitted = pending.draftBrowserRecordings.session;
    const edited = reducer(
      pending,
      setDraftBrowserRecording({
        draftKey: 'session',
        recording: { ...submitted, title: 'Edited during send' },
      }),
    );
    const completed = reducer(
      edited,
      removeDraftBrowserRecording({
        draftKey: 'session',
        id: submitted.id,
        expectedRecording: submitted,
      }),
    );
    expect(completed.draftBrowserRecordings.session.title).toBe('Edited during send');
  });

  it('clears an unchanged successful submission using the immutable snapshot', () => {
    const pending = reducer(
      undefined,
      setDraftBrowserRecording({ draftKey: 'session', recording: draft }),
    );
    const submitted = pending.draftBrowserRecordings.session;
    const completed = reducer(
      pending,
      removeDraftBrowserRecording({
        draftKey: 'session',
        id: submitted.id,
        expectedRecording: submitted,
      }),
    );
    expect(completed.draftBrowserRecordings.session).toBeUndefined();
  });

  it('still allows explicit user discard without a submission snapshot', () => {
    const pending = reducer(
      undefined,
      setDraftBrowserRecording({ draftKey: 'session', recording: draft }),
    );
    const completed = reducer(
      pending,
      removeDraftBrowserRecording({ draftKey: 'session', id: draft.id }),
    );
    expect(completed.draftBrowserRecordings.session).toBeUndefined();
  });
});
