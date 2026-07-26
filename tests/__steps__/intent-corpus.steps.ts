/**
 * Eval-driven intent gate suite (docs/design/ask-xavier-queries-spec.md §4) —
 * iterates EVERY labeled line in tests/intent-corpus.jsonl through the
 * unified gate (src/domain/intentGate.ts's `detectIntent`, the SAME
 * query-then-account order `runParse` uses) and asserts the result matches
 * the corpus's `expect` field. A plain jest suite (not jest-cucumber) per
 * the spec's "or a plain jest suite" allowance — the corpus file itself
 * already carries the human-readable "why" in each line's `note`, so a
 * .feature file would just be duplicating it.
 *
 * This is a 100% bar, not a statistical threshold (the gate is
 * deterministic): every single line must pass. `npm run eval:intent`
 * (evals-lite/intent-report.mjs) runs the SAME corpus for a human-readable
 * per-class table; keep the two in sync (the eval script reads this same
 * .jsonl file, so they can't drift on data — only on assertion style).
 */
import fs from 'fs';
import path from 'path';
import { detectIntent, UnifiedIntent } from '../../src/domain/intentGate';

function loadCorpus(): Array<{ text: string; expect: string; note: string }> {
  const filePath = path.resolve(__dirname, '../intent-corpus.jsonl');
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { text: string; expect: string; note: string });
}

const VALID_EXPECTATIONS = new Set(['create', 'update', 'delete', 'query', 'null']);

describe('intent corpus — unified gate (eval-driven, spec §4/§7)', () => {
  const corpus = loadCorpus();

  it('has a non-trivial, well-formed corpus', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(100);
    for (const c of corpus) {
      expect(typeof c.text).toBe('string');
      expect(c.text.length).toBeGreaterThan(0);
      expect(VALID_EXPECTATIONS.has(c.expect)).toBe(true);
      expect(typeof c.note).toBe('string');
      expect(c.note.length).toBeGreaterThan(0);
    }
  });

  it.each(corpus.map((c) => [c.text, c.expect, c.note] as const))(
    '%s -> %s',
    (text, expectLabel, note) => {
      const expected: UnifiedIntent = expectLabel === 'null' ? null : (expectLabel as UnifiedIntent);
      const actual = detectIntent(text);
      expect({ text, actual, note }).toEqual({ text, actual: expected, note });
    }
  );
});
