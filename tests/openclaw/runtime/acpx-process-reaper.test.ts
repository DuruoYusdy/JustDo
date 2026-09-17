import { describe, expect, test } from 'vitest';

import { commandContainsPathUnderRoot } from '../../../openclaw-extensions/acpx/src/command-line';

describe('ACPX process lease command detection', () => {
  test('recognizes a JSON-quoted Windows wrapper argv under the managed root', () => {
    expect(
      commandContainsPathUnderRoot({
        command:
          '"C:\\\\Program Files\\\\nodejs\\\\node.exe" "C:\\\\Users\\\\tester\\\\state\\\\acpx\\\\claude-agent-acp-wrapper.mjs"',
        root: 'C:\\Users\\tester\\state\\acpx',
        basenames: new Set(['claude-agent-acp-wrapper.mjs', 'codex-acp-wrapper.mjs']),
      }),
    ).toBe(true);
  });

  test('rejects a generated wrapper outside the managed root', () => {
    expect(
      commandContainsPathUnderRoot({
        command:
          '"C:\\\\Program Files\\\\nodejs\\\\node.exe" "D:\\\\other\\\\acpx\\\\codex-acp-wrapper.mjs"',
        root: 'C:\\Users\\tester\\state\\acpx',
        basenames: new Set(['claude-agent-acp-wrapper.mjs', 'codex-acp-wrapper.mjs']),
      }),
    ).toBe(false);
  });
});
