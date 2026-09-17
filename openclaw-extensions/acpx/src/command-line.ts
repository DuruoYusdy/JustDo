/**
 * Small shell-command helpers for ACPX-launched processes. Splitting supports
 * simple quoted command strings from config without invoking a shell parser.
 */
/** Quote one command argument for display or config serialization. */
export function quoteCommandPart(value: string): string {
  return JSON.stringify(value);
}

/** Split a command string into argv-like parts using simple quote/backslash rules. */
export function splitCommandParts(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const ch of value) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (escaping) {
    current += '\\';
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

/** Match a serialized argv path against a managed root and filename allowlist. */
export function commandContainsPathUnderRoot(params: {
  command: string;
  root: string;
  basenames: ReadonlySet<string>;
}): boolean {
  const normalizedRoot = params.root.replaceAll('\\', '/').replace(/\/+$/, '');
  return splitCommandParts(params.command).some(part => {
    const normalizedPart = part.replaceAll('\\', '/');
    const basename = normalizedPart.slice(normalizedPart.lastIndexOf('/') + 1);
    return params.basenames.has(basename) && normalizedPart.startsWith(`${normalizedRoot}/`);
  });
}
