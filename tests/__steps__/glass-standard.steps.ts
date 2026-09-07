import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';

const feature = loadFeature(path.join(__dirname, '..', '__features__', 'glass-standard.feature'));

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

function allTsxFiles(): string[] {
  return [...tsxFiles(path.join(ROOT, 'app')), ...tsxFiles(path.join(ROOT, 'src'))];
}

// ─── Scenario 1: <Glass only through a family component ───────────────────
//
// The family components own their own <Glass>; everywhere else is a call
// site that hasn't been migrated yet. `removedIn` names the step that
// deletes the entry — see glass-standard-adoption-spec.md §4.
const GLASS_FAMILY_FILES = [
  'Glass.tsx',
  'Fab.tsx',
  'IconButton.tsx',
  'Chip.tsx',
  'Composer.tsx',
  'ScreenHeader.tsx',
  'BottomSheet.tsx',
  'MenuPanel.tsx',
].map((name) => path.join(ROOT, 'src', 'components', 'ui', name));

interface GlassAllowlistEntry {
  file: string; // relative to ROOT
  removedIn: string;
  reason: string;
}

const GLASS_CALL_SITE_ALLOWLIST: GlassAllowlistEntry[] = [
  // S1 replaces each of these 5 inline FABs with <Fab>, whose own <Glass>
  // lives inside Fab.tsx (already on the family list above).
  { file: 'app/manage-categories.tsx', removedIn: 'S1', reason: 'inline FAB copy — Fab.tsx replaces it' },
  { file: 'app/manage-payees.tsx', removedIn: 'S1', reason: 'inline FAB copy — Fab.tsx replaces it' },
  { file: path.join('app', '(tabs)', 'transactions.tsx'), removedIn: 'S1', reason: 'inline FAB copy — Fab.tsx replaces it' },
  { file: 'app/manage-accounts.tsx', removedIn: 'S1', reason: 'inline FAB copy — Fab.tsx replaces it' },
  { file: path.join('app', 'account', '[id].tsx'), removedIn: 'S1', reason: 'inline FAB copy — Fab.tsx replaces it' },
  // S6 gives ContextMenu's bottomRight mode and SlashMenu a `panel` glass
  // sibling (spec §4 S6, R9's animation-free anchor). Neither file uses
  // <Glass> yet on this tree — tagged ahead of time per the spec's explicit
  // instruction so the scenario does not need re-authoring when S6 adds it.
  { file: 'src/components/ui/ContextMenu.tsx', removedIn: 'S6', reason: 'gains a panel glass sibling in bottomRight mode' },
  { file: path.join('app', '(tabs)', 'index.tsx'), removedIn: 'S6', reason: 'SlashMenu host — gains a panel glass sibling' },
];

// ─── Scenario 3: no inline 56pt FAB box outside Fab.tsx ────────────────────
//
// Flags a `width: 56` literal only when a `height: 56` literal sits within
// the same small window (the FAB's own style object) — this is what keeps
// an unrelated `width: 56` (e.g. a settings avatar-swatch column) out of the
// scan, the same way the FAB pattern itself always pairs the two.
const SIZE56_ALLOWLIST = [
  'app/manage-categories.tsx',
  'app/manage-payees.tsx',
  path.join('app', '(tabs)', 'transactions.tsx'),
  'app/manage-accounts.tsx',
  path.join('app', 'account', '[id].tsx'),
].map((f) => path.join(ROOT, f));

interface IconAllowlistEntry {
  file: string;
  size: number;
  /** How many occurrences of this size the file is allowed. */
  count: number;
  removedIn: string | null;
}

function loadIconAllowlist(): IconAllowlistEntry[] {
  const raw = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'icon-size-allowlist.json'), 'utf8');
  return JSON.parse(raw).entries;
}

defineFeature(feature, (test) => {
  let files: string[];

  const givenFiles = (given: any) =>
    given('every tsx file under app and src', () => {
      files = allTsxFiles();
    });

  test('Glass is only ever used through a family component', ({ given, then }) => {
    givenFiles(given);
    then('every "<Glass" use should be inside a glass family component file or the allowlist', () => {
      const offenders: string[] = [];
      for (const f of files) {
        if (GLASS_FAMILY_FILES.includes(f)) continue;
        const rel = path.relative(ROOT, f);
        if (GLASS_CALL_SITE_ALLOWLIST.some((e) => path.join(ROOT, e.file) === f)) continue;
        const src = fs.readFileSync(f, 'utf8');
        const count = (src.match(/<Glass(?![A-Za-z])/g) || []).length;
        if (count > 0) offenders.push(`${rel}: ${count}`);
      }
      expect(offenders).toEqual([]);
    });
  });

  test('No call site uses the retired "card" material', ({ given, then }) => {
    givenFiles(given);
    then('no file should use material="card"', () => {
      const offenders = files
        .filter((f) => /material=(?:"card"|'card')/.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(ROOT, f));
      expect(offenders).toEqual([]);
    });
  });

  test('No 56pt box literal outside Fab', ({ given, then }) => {
    givenFiles(given);
    then('no file should pair a width 56 and height 56 literal outside Fab.tsx or the allowlist', () => {
      const offenders: string[] = [];
      for (const f of files) {
        if (path.basename(f) === 'Fab.tsx') continue;
        if (SIZE56_ALLOWLIST.includes(f)) continue;
        const src = fs.readFileSync(f, 'utf8');
        const widthRe = /\bwidth:\s*56\b/g;
        let m: RegExpExecArray | null;
        while ((m = widthRe.exec(src))) {
          const windowStart = Math.max(0, m.index - 80);
          const windowEnd = Math.min(src.length, m.index + 80);
          const win = src.slice(windowStart, windowEnd);
          if (/\bheight:\s*56\b/.test(win)) {
            const line = src.slice(0, m.index).split('\n').length;
            offenders.push(`${path.relative(ROOT, f)}:${line}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  test('No Feather icon size outside the ICON scale', ({ given, then }) => {
    givenFiles(given);
    then('no Feather size literal should fall outside ICON values or the icon-size allowlist', () => {
      const ICON_VALUES = new Set([14, 18, 24]);
      const allowlist = loadIconAllowlist();
      const seen = new Map<string, number>();
      const offenders: string[] = [];
      for (const f of files) {
        const rel = path.relative(ROOT, f);
        const src = fs.readFileSync(f, 'utf8');
        const lines = src.split('\n');
        lines.forEach((line, i) => {
          const re = /<Feather\b[^>]*?size=\{(\d+)\}/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line))) {
            const size = parseInt(m[1]!, 10);
            if (ICON_VALUES.has(size)) continue;
            const lineNo = i + 1;
            const key = `${rel}|${size}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
            const allowed = allowlist.some((e) => e.file === rel && e.size === size);
            if (!allowed) offenders.push(`${rel}:${lineNo}: size={${size}}`);
          }
        });
      }
      // Over budget: the file is grandfathered for N of this size and now
      // has more. Under budget is fine — a step removed one.
      for (const e of allowlist) {
        const n = seen.get(`${e.file}|${e.size}`) ?? 0;
        if (n > e.count) {
          offenders.push(`${e.file}: size={${e.size}} appears ${n}x, allowlisted for ${e.count}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});
