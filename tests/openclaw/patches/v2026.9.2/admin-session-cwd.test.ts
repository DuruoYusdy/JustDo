import { describe, expect, it } from 'vitest';

const patch = require('../../../../scripts/patches/v2026.9.2/028-admin-session-cwd.cjs') as {
  __testing: {
    MARKER: string;
    transform: (content: string, filePath?: string) => string;
  };
};

const { MARKER, transform } = patch.__testing;

describe('OpenClaw admin session cwd patch', () => {
  it.each([
    'sessionCwd && !requestedExecNode && (requestedProjectId || p.worktree !== true)',
    'sessionCwd && !requestedExecNode && (requestedProjectId || p5.worktree !== true)',
  ])('keeps sandbox containment for non-admin callers and admits admin cwd (%s)', anchor => {
    const source = `enforceSandboxContainment: Boolean(${anchor}),`;
    const result = transform(source);

    expect(result).toContain('!clientScopes.includes(ADMIN_SCOPE)');
    expect(result).toContain(MARKER);
    expect(transform(result)).toBe(result);
  });

  it('rejects partial and ambiguous runtime shapes', () => {
    expect(() => transform(`const marker = '${MARKER}';`)).toThrow(/partial/);
    expect(() =>
      transform(
        'sessionCwd && !requestedExecNode && (requestedProjectId || p.worktree !== true)\n' +
          'sessionCwd && !requestedExecNode && (requestedProjectId || q.worktree !== true)',
      ),
    ).toThrow(/anchor count is 2/);
  });
});
