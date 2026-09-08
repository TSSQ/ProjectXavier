import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';

const feature = loadFeature(
  path.join(__dirname, '..', '__features__', 'radius-scale.feature')
);

const ROOT = path.join(__dirname, '..', '..');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// Pre-existing inline `borderRadius: N` literals outside the token scale
// (glass-standard-adoption-spec.md §4 S0's radius-scale extension). Each
// entry's `removedIn` names the step whose migration list touches that
// call site; `null` means no step in S1-S7 reaches it and it is left for a
// future pass, same status as the icon-size allowlist's `null` entries.
/**
 * Keyed on file + value + COUNT, deliberately not on a line number. Every
 * step of this adoption edits these files, and a line-keyed allowlist has to
 * be renumbered each time — which is how a genuine new offender gets waved
 * through as "just the numbers moving again". The count is the teeth: add
 * another literal of the same value to the same file and this fails, even
 * though the file is grandfathered.
 */
interface RadiusAllowlistEntry {
  file: string; // relative to ROOT, forward slashes
  value: number;
  /** How many occurrences of this value the file is allowed. */
  count: number;
  removedIn: string | null;
  reason: string;
}

const RADIUS_LITERAL_ALLOWLIST: RadiusAllowlistEntry[] = [
  // Dashboard legend/page dots and a checkbox circle: no S-step in the
  // glass-standard spec migrates them (ContextMenu's and AmountKeypad's own
  // radii were the named targets, migrated in S6/S5 respectively). Left for
  // a future pass — see the S0 delivery report.
  { file: 'app/(tabs)/dashboard.tsx', value: 2, count: 4, removedIn: null, reason: 'legend dot, 2 on an 8pt box — not on the scale and not a circle (4 would be); needs a design call, not a forced token' },
  { file: 'app/(tabs)/index.tsx', value: 6, count: 1, removedIn: null, reason: 'checkbox at 6 on a 22pt box — xs(4) or sm(8) both visibly reshape it' },
  { file: 'src/components/ui/AccountFilterSheet.tsx', value: 10, count: 1, removedIn: null, reason: 'emoji chip at 10 on a 38pt box — sm(8)/md(14) both visibly reshape it' },
];

defineFeature(feature, (test) => {
  let files: string[];

  const givenFiles = (given: any) =>
    given('every tsx file under app and src', () => {
      files = [
        ...tsxFiles(path.join(ROOT, 'app')),
        ...tsxFiles(path.join(ROOT, 'src')),
      ];
    });

  test('No component uses a radius outside the token scale', ({ given, then }) => {
    givenFiles(given);
    then(/^none should use a rounded- class outside "(.*)"$/, (allowedCsv: string) => {
      const allowed = new Set(allowedCsv.split(',').map((s) => s.trim()));
      const offenders: string[] = [];
      for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        // Only inside className strings — the word "rounded" appears in prose.
        for (const m of src.matchAll(/className=[{`"'][^`"'}]*/g)) {
          for (const cls of m[0].matchAll(/\brounded(?:-t|-b|-l|-r)?-([a-z0-9[\]]+)/g)) {
            if (!allowed.has(cls[1]!)) {
              offenders.push(`${path.relative(ROOT, f)}: rounded-${cls[1]}`);
            }
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  test('No component uses an arbitrary pixel radius', ({ given, then }) => {
    givenFiles(given);
    then('none should use a rounded-[Npx] class', () => {
      const offenders = files
        .filter((f) => /rounded(?:-[tblr])?-\[\d+px\]/.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(ROOT, f));
      expect(offenders).toEqual([]);
    });
  });

  test('No component uses an inline borderRadius literal outside the token scale', ({ given, then }) => {
    givenFiles(given);
    then(/^none should use an inline borderRadius outside "(.*)"$/, (allowedCsv: string) => {
      const allowed = new Set(allowedCsv.split(',').map((s) => parseFloat(s.trim())));
      const offenders: string[] = [];
      const found = new Map<string, number>();
      for (const f of files) {
        const rel = path.relative(ROOT, f).split(path.sep).join('/');
        const src = fs.readFileSync(f, 'utf8');
        const lines = src.split('\n');
        lines.forEach((line, i) => {
          const re = /borderRadius:\s*(\d+(?:\.\d+)?)\b/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line))) {
            const value = parseFloat(m[1]!);
            if (allowed.has(value)) continue;
            const lineNo = i + 1;
            const key = `${rel}|${value}`;
            found.set(key, (found.get(key) ?? 0) + 1);
            const entry = RADIUS_LITERAL_ALLOWLIST.find((e) => e.file === rel && e.value === value);
            if (!entry) offenders.push(`${rel}:${lineNo}: borderRadius: ${value}`);
          }
        });
      }
      // Over budget: the file is grandfathered for N of this value and now
      // has more. Under budget is fine — a step removed one.
      for (const e of RADIUS_LITERAL_ALLOWLIST) {
        const seen = found.get(`${e.file}|${e.value}`) ?? 0;
        if (seen > e.count) {
          offenders.push(
            `${e.file}: borderRadius ${e.value} appears ${seen}x, allowlisted for ${e.count}`
          );
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});
