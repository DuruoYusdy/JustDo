import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRODUCT_NAME_LOWERCASE } from '../../../shared/productMetadata';
import {
  ApprovedPlanArtifactError,
  ApprovedPlanArtifactStore,
  MAX_APPROVED_PLAN_ARTIFACT_BYTES,
} from './approvedPlanArtifactStore';

const temporaryDirectories: string[] = [];

const createStore = (): { store: ApprovedPlanArtifactStore; workspaceRoot: string } => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-approved-plan-'));
  temporaryDirectories.push(workspaceRoot);
  return { store: new ApprovedPlanArtifactStore(), workspaceRoot };
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('ApprovedPlanArtifactStore', () => {
  it('publishes normalized UTF-8 content below the product-scoped workspace path', () => {
    const { store, workspaceRoot } = createStore();

    const reference = store.publish({
      workspaceRoot,
      sessionId: 'session-1',
      planId: 'plan-1',
      markdown: '# 计划\r\n\rStep one\rStep two',
    });

    const expected = '# 计划\n\nStep one\nStep two';
    expect(reference.workspaceRoot).toBe(workspaceRoot);
    expect(reference.relativePath).toBe(
      path.join(`.${PRODUCT_NAME_LOWERCASE}`, 'plans', 'session-1', 'plan-1.md'),
    );
    expect(reference.byteLength).toBe(Buffer.byteLength(expected, 'utf8'));
    expect(reference.sha256).toBe(crypto.createHash('sha256').update(expected).digest('hex'));
    expect(fs.readFileSync(path.join(workspaceRoot, reference.relativePath), 'utf8')).toBe(
      expected,
    );
    expect(store.readVerified(workspaceRoot, reference)).toBe(expected);
  });

  it('replays the same immutable artifact and rejects different content', () => {
    const { store, workspaceRoot } = createStore();
    const input = { sessionId: 'session-1', planId: 'plan-1', markdown: '# Plan' };
    const first = store.publish({ ...input, workspaceRoot });

    expect(store.publish({ ...input, workspaceRoot })).toEqual(first);
    expect(() =>
      store.publish({ ...input, workspaceRoot, markdown: '# Different plan' }),
    ).toThrowError(
      expect.objectContaining<Partial<ApprovedPlanArtifactError>>({ code: 'content_conflict' }),
    );
    expect(fs.readFileSync(path.join(workspaceRoot, first.relativePath), 'utf8')).toBe('# Plan');
  });

  it('detects a modified artifact before returning its content', () => {
    const { store, workspaceRoot } = createStore();
    const reference = store.publish({
      workspaceRoot,
      sessionId: 'session-1',
      planId: 'plan-1',
      markdown: '# Plan',
    });
    fs.writeFileSync(path.join(workspaceRoot, reference.relativePath), '# Tampered');

    expect(() => store.readVerified(workspaceRoot, reference)).toThrowError(
      expect.objectContaining<Partial<ApprovedPlanArtifactError>>({ code: 'integrity_mismatch' }),
    );
  });

  it('rejects unsafe identifiers and forged relative paths', () => {
    const { store, workspaceRoot } = createStore();

    expect(() =>
      store.publish({ workspaceRoot, sessionId: '..', planId: 'plan-1', markdown: '# Plan' }),
    ).toThrowError(
      expect.objectContaining<Partial<ApprovedPlanArtifactError>>({ code: 'invalid_id' }),
    );

    const reference = store.publish({
      workspaceRoot,
      sessionId: 'session-1',
      planId: 'plan-1',
      markdown: '# Plan',
    });
    expect(() =>
      store.readVerified(workspaceRoot, {
        ...reference,
        relativePath: path.join('..', 'plan.md'),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ApprovedPlanArtifactError>>({ code: 'invalid_reference' }),
    );
  });

  it('rejects a relative workspace and product-directory links', () => {
    const { store, workspaceRoot } = createStore();

    expect(() =>
      store.publish({
        workspaceRoot: 'relative-workspace',
        sessionId: 'session-1',
        planId: 'plan-1',
        markdown: '# Plan',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ApprovedPlanArtifactError>>({ code: 'invalid_reference' }),
    );

    const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'approved-plan-external-'));
    temporaryDirectories.push(externalDirectory);
    fs.symlinkSync(
      externalDirectory,
      path.join(workspaceRoot, `.${PRODUCT_NAME_LOWERCASE}`),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() =>
      store.publish({
        workspaceRoot,
        sessionId: 'session-1',
        planId: 'plan-1',
        markdown: '# Plan',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ApprovedPlanArtifactError>>({ code: 'invalid_reference' }),
    );
    expect(fs.readdirSync(externalDirectory)).toEqual([]);
  });

  it('uses the workspace root bound into the persisted artifact reference', () => {
    const { store, workspaceRoot } = createStore();
    const otherWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-approved-plan-other-'));
    temporaryDirectories.push(otherWorkspace);
    const reference = store.publish({
      workspaceRoot,
      sessionId: 'session-1',
      planId: 'plan-1',
      markdown: '# Bound plan',
    });

    expect(store.readVerified(otherWorkspace, reference)).toBe('# Bound plan');
  });

  it('reads a legacy AppData artifact so an existing handoff can migrate', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-approved-plan-workspace-'));
    const legacyUserDataPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'justdo-approved-plan-legacy-'),
    );
    temporaryDirectories.push(workspaceRoot, legacyUserDataPath);
    const store = new ApprovedPlanArtifactStore(legacyUserDataPath);
    const markdown = '# Legacy plan';
    const relativePath = path.join('plans', 'v1', 'session-1', 'plan-1.md');
    fs.mkdirSync(path.dirname(path.join(legacyUserDataPath, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(legacyUserDataPath, relativePath), markdown);

    expect(
      store.readVerified(workspaceRoot, {
        sessionId: 'session-1',
        planId: 'plan-1',
        relativePath,
        sha256: crypto.createHash('sha256').update(markdown).digest('hex'),
        byteLength: Buffer.byteLength(markdown),
      }),
    ).toBe(markdown);
  });

  it('enforces the UTF-8 byte limit after line-ending normalization', () => {
    const { store, workspaceRoot } = createStore();

    expect(() =>
      store.publish({
        workspaceRoot,
        sessionId: 'session-1',
        planId: 'plan-1',
        markdown: '界'.repeat(Math.floor(MAX_APPROVED_PLAN_ARTIFACT_BYTES / 3) + 1),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ApprovedPlanArtifactError>>({ code: 'content_too_large' }),
    );
  });

  it('does not expose a destination or leave a temporary file when publishing fails', () => {
    const { store, workspaceRoot } = createStore();
    vi.spyOn(fs, 'linkSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('disk failure'), { code: 'EIO' });
    });

    expect(() =>
      store.publish({
        workspaceRoot,
        sessionId: 'session-1',
        planId: 'plan-1',
        markdown: '# Plan',
      }),
    ).toThrow('disk failure');

    const targetDirectory = path.join(
      workspaceRoot,
      `.${PRODUCT_NAME_LOWERCASE}`,
      'plans',
      'session-1',
    );
    expect(fs.existsSync(path.join(targetDirectory, 'plan-1.md'))).toBe(false);
    expect(fs.readdirSync(targetDirectory)).toEqual([]);
  });

  it('uses an exclusive-copy fallback when the workspace filesystem rejects hard links', () => {
    const { store, workspaceRoot } = createStore();
    vi.spyOn(fs, 'linkSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('hard links unavailable'), { code: 'EXDEV' });
    });

    const reference = store.publish({
      workspaceRoot,
      sessionId: 'session-1',
      planId: 'plan-1',
      markdown: '# Plan',
    });

    expect(store.readVerified(workspaceRoot, reference)).toBe('# Plan');
  });

  it('removes only the requested managed session artifact directory', () => {
    const { store, workspaceRoot } = createStore();
    const first = store.publish({
      workspaceRoot,
      sessionId: 'session-1',
      planId: 'plan-1',
      markdown: '# First',
    });
    const second = store.publish({
      workspaceRoot,
      sessionId: 'session-2',
      planId: 'plan-2',
      markdown: '# Second',
    });

    expect(store.removeSessionArtifacts(workspaceRoot, 'session-1')).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, first.relativePath))).toBe(false);
    expect(fs.existsSync(path.join(workspaceRoot, second.relativePath))).toBe(true);
    expect(store.removeSessionArtifacts(workspaceRoot, 'session-1')).toBe(false);
  });

  it('cleans stale managed temporary files without touching plans or recent files', () => {
    const { store, workspaceRoot } = createStore();
    const reference = store.publish({
      workspaceRoot,
      sessionId: 'session-1',
      planId: 'plan-1',
      markdown: '# Plan',
    });
    const sessionDirectory = path.dirname(path.join(workspaceRoot, reference.relativePath));
    const stale = path.join(
      sessionDirectory,
      '.plan-2.123.aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.tmp',
    );
    const recent = path.join(
      sessionDirectory,
      '.plan-3.123.11111111-2222-4333-8444-555555555555.tmp',
    );
    fs.writeFileSync(stale, 'stale');
    fs.writeFileSync(recent, 'recent');
    fs.utimesSync(stale, new Date(1_000), new Date(1_000));
    fs.utimesSync(recent, new Date(9_500), new Date(9_500));

    expect(
      store.cleanupStaleTemporaryFiles(workspaceRoot, { now: 10_000, minimumAgeMs: 1_000 }),
    ).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, reference.relativePath))).toBe(true);
  });

  it('refuses to recursively remove a session directory with unmanaged content', () => {
    const { store, workspaceRoot } = createStore();
    const reference = store.publish({
      workspaceRoot,
      sessionId: 'session-1',
      planId: 'plan-1',
      markdown: '# Plan',
    });
    const sessionDirectory = path.dirname(path.join(workspaceRoot, reference.relativePath));
    fs.writeFileSync(path.join(sessionDirectory, 'unmanaged.txt'), 'keep');

    expect(() => store.removeSessionArtifacts(workspaceRoot, 'session-1')).toThrowError(
      expect.objectContaining<Partial<ApprovedPlanArtifactError>>({ code: 'invalid_reference' }),
    );
    expect(fs.existsSync(path.join(workspaceRoot, reference.relativePath))).toBe(true);
    expect(fs.existsSync(path.join(sessionDirectory, 'unmanaged.txt'))).toBe(true);
  });
});
