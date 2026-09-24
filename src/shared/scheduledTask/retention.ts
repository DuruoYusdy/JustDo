const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

// Mirrors the native cron duration grammar. Bare numbers are hours; zero disables pruning.
export function parseSessionRetentionMs(value: string): number | null {
  const text = value.trim().toLowerCase();
  const single = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(text);
  let total = 0;
  if (single) {
    total = Number(single[1]) * UNIT_MS[single[2] ?? 'h'];
  } else {
    let consumed = 0;
    for (const match of text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) {
      if (match.index !== consumed) return null;
      total += Number(match[1]) * UNIT_MS[match[2]];
      consumed += match[0].length;
    }
    if (consumed === 0 || consumed !== text.length) return null;
  }
  const rounded = Math.round(total);
  return Number.isSafeInteger(rounded) ? rounded : null;
}
