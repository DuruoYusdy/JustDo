import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { transformSync } from 'esbuild';
import { describe, expect, test, vi } from 'vitest';

const patch = require('../../../../scripts/patches/v2026.9.2/029-peer-skill-review-opt-in.cjs') as {
  applyPatch: (root: string) => string[];
  verifyPatch: (root: string) => void;
  __testing: {
    ANCHOR: string;
    MARKER: string;
    transform: (text: string, file: string, options?: { freshBundlePass?: boolean }) => string;
  };
};
const { ANCHOR, MARKER, transform } = patch.__testing;
const source = `function reconcile(specs, jobs) {
  ${ANCHOR}
  return specs.map(spec => spec.input.enabled);
}`;
const runtimeRoot = path.resolve(
  process.env.JUSTDO_TEST_PRISTINE_RUNTIME ?? 'vendor/openclaw-runtime/current',
);

describe('peer skill-review opt-in', () => {
  test.skipIf(!fs.existsSync(path.join(runtimeRoot, 'dist')))(
    'native reconciliation never adds missing peers and still retains existing jobs',
    async () => {
      const dist = path.join(runtimeRoot, 'dist');
      const file = fs
        .readdirSync(dist)
        .find(
          name =>
            /^server-cron-.*\.js$/u.test(name) &&
            fs.readFileSync(path.join(dist, name), 'utf8').includes(ANCHOR),
        );
      expect(file).toBeDefined();
      const original = fs.readFileSync(path.join(dist, file!), 'utf8');
      const patched = transform(original, file!);
      expect(transform(patched, file!)).toBe(patched);
      const body = patched.match(
        /async function reconcileSkillCollectionReviewJobs\(params\) \{[\s\S]*?\n\}(?=\r?\n\/\/#endregion)/u,
      )?.[0];
      expect(body).toBeDefined();
      const jobs = new Map([
        ['enabled-peer', { id: 'existing-on', enabled: true }],
        ['paused-peer', { id: 'existing-off', enabled: false }],
        ['removed-peer', { id: 'obsolete', enabled: true }],
      ]);
      const reconcile = vm.runInNewContext(`${body}; reconcileSkillCollectionReviewJobs`, {
        resolveSkillCollectionReviewMonitorSpecs: () =>
          ['main', 'new-peer', 'enabled-peer', 'paused-peer'].map(agentId => ({
            agentId,
            input: { agentId, enabled: true },
          })),
        partitionSystemMonitors: () => ({ retained: jobs, duplicates: [] }),
        skillCollectionReviewMonitorAgentId: () => undefined,
      });
      const add = vi.fn(
        async (_input: { agentId: string; enabled: boolean }, _options: unknown) => undefined,
      );
      const remove = vi.fn(async () => undefined);
      const params = {
        cfg: {},
        cron: { list: async () => [], add, remove },
        logger: { warn: vi.fn() },
      };
      for (let pass = 0; pass < 2; pass++) {
        add.mockClear();
        expect(await reconcile(params)).toEqual({ ok: true });
        expect(add.mock.calls.map(([input]) => input)).toEqual([
          { agentId: 'main', enabled: true },
          { agentId: 'enabled-peer', enabled: true },
          { agentId: 'paused-peer', enabled: false },
        ]);
        expect(remove).toHaveBeenCalledWith('obsolete', { systemOwned: true });
        expect(remove).not.toHaveBeenCalledWith('existing-on', expect.anything());
        expect(remove).not.toHaveBeenCalledWith('existing-off', expect.anything());
      }
    },
  );

  test('omits new peers, preserves existing peer settings, and leaves main under the global gate', () => {
    const reconcile = vm.runInNewContext(`${transform(source, 'fixture')}; reconcile`, {
      partitionSystemMonitors: (jobs: Map<string, { enabled: boolean }>) => ({
        retained: jobs,
        duplicates: [],
      }),
      skillCollectionReviewMonitorAgentId: () => undefined,
    }) as (specs: unknown[], jobs: Map<string, { enabled: boolean }>) => boolean[];
    const jobs = new Map([
      ['enabled-peer', { enabled: true }],
      ['paused-peer', { enabled: false }],
    ]);
    const ids = ['main', 'new-peer', 'enabled-peer', 'paused-peer'];
    const specs = (enabled: boolean) => ids.map(agentId => ({ agentId, input: { enabled } }));
    expect(Array.from(reconcile(specs(true), jobs))).toEqual([true, true, false]);
    expect(Array.from(reconcile(specs(false), jobs))).toEqual([false, false, false]);
    // Reconciliation does not create missing peers on later passes either.
    expect(Array.from(reconcile(specs(true), jobs))).toEqual([true, true, false]);
    // An existing explicitly provisioned monitor remains eligible.
    jobs.set('new-peer', { enabled: false });
    expect(Array.from(reconcile(specs(true), jobs))).toEqual([true, false, true, false]);
  });

  test('accepts exact current source and bundled formatting only', () => {
    const patched = transform(source, 'fixture');
    expect(transform(patched, 'fixture')).toBe(patched);
    // The runtime bundler keeps JUSTDO block markers as inline comments.
    const bundled = transformSync(patched.replace(`/*${MARKER}*/`, `/*!${MARKER}*/`), {
      legalComments: 'inline',
    }).code.replace(`/*!${MARKER}*/`, `/*${MARKER}*/`);
    expect(transform(bundled, 'bundle')).toBe(bundled);
    expect(() => transform(patched.replace('!== "main"', '=== "main"'), 'fixture')).toThrow(
      /partial/,
    );
    expect(() => transform(patched.replace(MARKER, 'OLD_MARKER'), 'fixture')).toThrow(/partial/);
    expect(() => transform(`${source}\n${source}`, 'fixture')).toThrow(/one.*anchor/);
    expect(() =>
      transform(`${source}\n/*JUSTDO_PEER_SKILL_REVIEW_DEFAULT_PAUSED_V2026_9_2*/`, 'fixture'),
    ).toThrow(/historical/);
  });

  test('restores a stripped marker only for the exact fresh esbuild bundle', () => {
    const bundled = transformSync(transform(source, 'source.js')).code;
    expect(bundled).not.toContain(MARKER);
    expect(() => transform(bundled, 'gateway-bundle.mjs')).toThrow(/partial/);
    expect(() => transform(bundled, 'source.js', { freshBundlePass: true })).toThrow(/partial/);
    const restored = transform(bundled, 'gateway-bundle.mjs', { freshBundlePass: true });
    expect(restored).toContain(MARKER);
    expect(transform(restored, 'gateway-bundle.mjs')).toBe(restored);
    expect(() =>
      transform(bundled.replace('!== "main"', '=== "main"'), 'gateway-bundle.mjs', {
        freshBundlePass: true,
      }),
    ).toThrow(/partial/);
  });

  test.each([false, true])(
    'patches the Gateway with bundle=%s while excluding the upstream worker distribution',
    bundlePresent => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'justdo-peer-skill-review-'));
      try {
        fs.mkdirSync(path.join(root, 'dist'));
        fs.mkdirSync(path.join(root, 'dist', 'worker'));
        const workerPath = path.join(root, 'dist', 'worker', 'worker.mjs');
        const worker = transformSync(source, { minify: true }).code;
        fs.writeFileSync(workerPath, worker);
        fs.writeFileSync(path.join(root, 'dist', 'server-cron.js'), source);
        if (bundlePresent) fs.writeFileSync(path.join(root, 'gateway-bundle.mjs'), source);
        expect(() => patch.verifyPatch(root)).toThrow(/incomplete/);
        expect(patch.applyPatch(root)).toHaveLength(bundlePresent ? 2 : 1);
        patch.verifyPatch(root);
        expect(patch.applyPatch(root)).toEqual([]);
        expect(fs.readFileSync(workerPath, 'utf8')).toBe(worker);
        fs.writeFileSync(path.join(root, 'dist', 'unexpected-copy.js'), source);
        expect(() => patch.applyPatch(root)).toThrow(/found source=2/);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
