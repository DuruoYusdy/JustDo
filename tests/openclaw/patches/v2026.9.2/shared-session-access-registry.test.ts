import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { transform } = require('../../../../scripts/patches/v2026.9.2/027-shared-session-access-registry.cjs').__testing;

describe('native scoped session access registry packaging', () => {
  it('shares providers between separate SDK and gateway module instances', () => {
    const context = vm.createContext({});
    const source = transform('let scopedSessionAccessProviders = new Set(); scopedSessionAccessProviders;');
    const first = vm.runInContext(`(() => { ${source} return scopedSessionAccessProviders; })()`, context);
    const second = vm.runInContext(`(() => { ${source} return scopedSessionAccessProviders; })()`, context);
    expect(first).toBe(second);
    first.add('provider');
    expect(second.has('provider')).toBe(true);
  });
  it('accepts only its exact current source and esbuild shapes', () => {
    const source = transform('let scopedSessionAccessProviders = new Set();');
    expect(transform(source)).toBe(source);
    const bundled = source.replace('[Symbol.for', '[/* @__PURE__ */ Symbol.for').replace('new Set()', '/* @__PURE__ */ new Set()');
    expect(transform(bundled)).toBe(bundled);
    expect(() => transform(source.replace('new Set()', 'new Map()'))).toThrow('Partial');
    expect(() => transform(source + source)).toThrow('Partial');
    expect(() => transform('let scopedSessionAccessProviders = new Map();')).toThrow('exactly once');
  });
});
