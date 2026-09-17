import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const patch = require('../../../../scripts/patches/v2026.9.2/022-justdo-reset-display-history.cjs') as {
  __testing: {
    MARKERS: { history: string; window: string };
    transformFile: (content: string, filePath: string) => string;
  };
};

function findRuntimeFile(needle: string): string {
  const root = path.resolve('vendor/openclaw-runtime/current/dist');
  const prefix = needle.includes('resolveVisibleHistoryProjection')
    ? 'session-transcript-readers-'
    : 'session-accessor-';
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.js')) continue;
    const candidate = path.join(root, entry.name);
    if (fs.readFileSync(candidate, 'utf8').includes(needle)) return candidate;
  }
  throw new Error(`Runtime fixture not found: ${needle}`);
}

describe('JustDo reset display-history patch', () => {
  test.each([
    'function resolveVisibleHistoryProjection(',
    'function readLatestActiveBoundaryMetadata(',
  ])('patches the compiled %s contract idempotently', needle => {
    const runtimeFile = findRuntimeFile(needle);
    const original = fs.readFileSync(runtimeFile, 'utf8');
    const transformed = patch.__testing.transformFile(original, runtimeFile);

    expect(transformed).not.toBe(original);
    expect(transformed).toContain('/^agent:[^:]+:justdo:/u.test(');
    expect(patch.__testing.transformFile(transformed, runtimeFile)).toBe(transformed);
  });

  test('rejects a partial source patch', () => {
    const runtimeFile = findRuntimeFile('function resolveVisibleHistoryProjection(');
    const original = fs.readFileSync(runtimeFile, 'utf8');
    const transformed = patch.__testing.transformFile(original, runtimeFile);
    const partial = transformed.replace(`/*${patch.__testing.MARKERS.history}*/`, '');

    expect(() => patch.__testing.transformFile(partial, runtimeFile)).toThrow(/partial/iu);
  });

  test('patches both projections in the bundled Gateway without source markers', () => {
    const bundleFile = path.resolve('vendor/openclaw-runtime/current/gateway-bundle.mjs');
    const original = fs.readFileSync(bundleFile, 'utf8');
    const transformed = patch.__testing.transformFile(original, bundleFile);

    expect(transformed).not.toBe(original);
    expect(transformed.match(/\/\^agent:\[\^:\]\+:justdo:\/u\.test\(/gu)).toHaveLength(2);
    expect(transformed).not.toContain('JUSTDO_RESET_DISPLAY_HISTORY_V2026_9_2');
    expect(transformed).not.toContain('JUSTDO_RESET_DISPLAY_WINDOW_V2026_9_2');
    expect(patch.__testing.transformFile(transformed, bundleFile)).toBe(transformed);
  }, 15_000);

  test('patches both projections in the worker bundle with template-literal constants', () => {
    const workerFile = path.resolve('vendor/openclaw-runtime/current/dist/worker/worker.mjs');
    const original = fs.readFileSync(workerFile, 'utf8');
    const transformed = patch.__testing.transformFile(original, workerFile);

    expect(transformed).not.toBe(original);
    expect(transformed).toContain(`/*${patch.__testing.MARKERS.history}*/`);
    expect(transformed).toContain(`/*${patch.__testing.MARKERS.window}*/`);
    expect(patch.__testing.transformFile(transformed, workerFile)).toBe(transformed);
  }, 15_000);

  test('keeps model-context reset selection unchanged', () => {
    const runtimeFile = findRuntimeFile('function readLatestActiveBoundaryMetadata(');
    const transformed = patch.__testing.transformFile(
      fs.readFileSync(runtimeFile, 'utf8'),
      runtimeFile,
    );

    expect(transformed).toContain('if (scope === "history")');
    expect(transformed).toMatch(
      /const compaction = readLatestActiveBoundaryMetadataByType\(projection, "compaction"/u,
    );
  });
});
