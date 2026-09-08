/**
 * Source-scan guards for the glass standard (glass-standard-adoption-
 * spec.md S0; style guide). These are text scans, not a real parser or
 * type-checker — same tradeoff as radius-scale.steps.ts — so it's worth
 * being explicit about what they structurally cannot see, rather than
 * silently claiming coverage they don't have:
 *
 *  - Icon SIZE literals are only scanned on `<Feather>` (this app's one icon
 *    set, per assets.ts) — a size on a different icon component is
 *    invisible here. Deferred to the Redline C1 icon-set pass (glass-
 *    standard-adoption-spec.md Follow-ups), same as every off-scale size
 *    already in tests/fixtures/icon-size-allowlist.json.
 *  - A non-literal `size={…}` is resolved with a MODEST evaluator (numeric
 *    literals, `ICON.sm`/`md`/`lg` member references pulled from the real
 *    `assets.ts` export, `+ - * /` over those, and a trailing `as Type`
 *    stripped) — enough to recognise the canonical `ICON.<key>` pattern the
 *    whole migration standardised on, without an allowlist entry for every
 *    correctly-migrated call site. Anything the evaluator can't resolve (a
 *    function call, an arbitrary local variable, a ternary) is flagged as a
 *    COMPUTED offender that must be allowlisted by its exact expression
 *    text — not silently ignored (QA round 2 MAJOR 1; `app/welcome.tsx`'s
 *    `Math.round(...)` formula was invisible before this fix, and so was
 *    any size hidden behind a stray '>' character earlier in the tag).
 *  - The 56pt-box guard (scenario 3) pairs `width: 56` and `height: 56` only
 *    within the SAME enclosing `{ … }` object literal. A style ARRAY that
 *    splits them across two objects (`style={[{width:56}, {height:56}]}`),
 *    or two separate `StyleSheet.create` keys spread together, defeats this
 *    — those properties never share an enclosing object, and there's no
 *    local text span to widen the search to without risking a false pair
 *    across unrelated sibling objects. This is a KNOWN, accepted blind spot
 *    (QA round 2 MINOR 5) — `tests/fixtures/glass-standard/style-array-
 *    56.fixture.tsx` pins today's actual (undetected) behaviour, so a
 *    future "fix" that starts silently merging unrelated objects gets
 *    caught here first, instead of this file quietly claiming coverage it
 *    doesn't have.
 *
 * All of the above scan a MASKED copy of the file (`maskComments`) rather
 * than the raw text: building the tag/attribute scanner to be quote- and
 * brace-aware (so it can see past a stray '>') means it also, correctly,
 * treats a backtick code-span inside a `/** … *\/` doc comment as a quoted
 * region — which is exactly how this file's OWN regression fixtures
 * document the bug they pin, in prose like `` `<Feather ... size={N} .../>`
 * ``. Masking comments to blanks (preserving every character's position and
 * every newline, so line numbers stay correct) before scanning means that
 * prose is never mistaken for a real tag, without weakening the real
 * quote/brace tracking used for the genuine JSX it also has to get right.
 */
import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { ICON } from '../../src/theme/assets';

const feature = loadFeature(path.join(__dirname, '..', '__features__', 'glass-standard.feature'));

const ROOT = path.join(__dirname, '..', '..');

function scanFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scanFiles(full, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function tsxFiles(dir: string): string[] {
  return scanFiles(dir, ['.tsx']);
}

function allTsxFiles(): string[] {
  return [...tsxFiles(path.join(ROOT, 'app')), ...tsxFiles(path.join(ROOT, 'src'))];
}

function allTsAndTsxFiles(): string[] {
  const extensions = ['.ts', '.tsx'];
  return [
    ...scanFiles(path.join(ROOT, 'app'), extensions),
    ...scanFiles(path.join(ROOT, 'src'), extensions),
  ];
}

/** The last non-whitespace character already written to `out` (comments'
 *  interiors are already blanked to spaces by the time we get here, so this
 *  correctly treats "the last thing before a comment" as whatever preceded
 *  the comment, not the comment's own text). Undefined at start of file. */
function lastNonSpace(out: string): string | undefined {
  for (let i = out.length - 1; i >= 0; i--) {
    const ch = out[i];
    if (ch !== ' ' && ch !== '\n' && ch !== '\t' && ch !== '\r') return ch;
  }
  return undefined;
}

/** Characters after which a `'` can legally START a real string literal —
 *  assignment/argument/collection/operator positions, never straight after
 *  a letter, digit or closing bracket (which is always prose: "Apple's",
 *  "don't"). Start-of-file/line falls out of `lastNonSpace` returning
 *  undefined, handled as "yes" by the caller. */
const CAN_PRECEDE_STRING = new Set(['=', ',', '(', '{', '[', ':', ';', '&', '|', '?', '!', '<', '>']);

/**
 * `src` with every `//…` and `/* … *\/` comment's INTERIOR replaced by
 * spaces (newlines kept as newlines) — same length, same line numbers,
 * quote-aware so a `//` or `/*` inside a real string is never mistaken for
 * a comment start. Used by every tag/attribute scanner below so a doc
 * comment that quotes a `<Feather ... size={N} .../>` in prose (this file's
 * own regression fixtures do exactly that) is never mistaken for real JSX.
 *
 * `'` is tracked, but only opens a string when the preceding non-space
 * character is one that can legally precede a string literal (QA round 4).
 * Two earlier, both wrong, simplifications: round 2 treated EVERY `'` as a
 * delimiter, so an apostrophe in ordinary prose ("Apple's iCloud",
 * app/backups.tsx:278) opened a quote state that never closed, desyncing
 * everything after it for the rest of the file (a LOUD failure — real
 * comments downstream stopped being masked at all, biting toward false
 * positives). Round 3 dropped `'` as a delimiter entirely to fix that, which
 * flipped the failure the other way: a real single-quoted string containing
 * `//` (`const href = 'https://x.co'`) now started comment-masking and
 * blinded the rest of that line — a SILENT false negative, the class both
 * prior rounds were trying to avoid. Checking what precedes the `'` (via
 * `lastNonSpace`, which already sees through masked comments to the real
 * code before them) tells the two apart: "Apple's" is preceded by a letter,
 * "= 'https" is preceded by `=`.
 */
function maskComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const ch = src[i]!;
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "'") {
      const prev = lastNonSpace(out);
      if (prev === undefined || CAN_PRECEDE_STRING.has(prev)) {
        quote = ch;
      }
      // else: an apostrophe in prose — pass through as an ordinary
      // character, deliberately NOT entering quote state.
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      out += '  ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
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

// S6 landed ContextMenu's `bottomRight` panel and SlashMenu on a `panel`
// Glass sibling — both go through MenuPanel.tsx (on the family list above),
// so nothing is left to grandfather here.
const GLASS_CALL_SITE_ALLOWLIST: GlassAllowlistEntry[] = [];

// ─── Scenario 3: no inline 56pt FAB box outside Fab.tsx ────────────────────
//
// Flags a `width: 56` literal only when a `height: 56` literal sits inside
// the SAME enclosing `{ … }` style-object literal (the FAB's own style
// object) — this is what keeps an unrelated `width: 56` (e.g. a settings
// avatar-swatch column) out of the scan, the same way the FAB pattern itself
// always pairs the two.
//
// QA round 1: a fixed ±80-character text window (rather than the object's
// own braces) is defeated by a normal style object with a few intervening
// properties — anything FAB-adjacent carrying a glow, shadow or border is
// exactly that. Pairing is now done by walking brace depth to find the
// smallest `{ … }` that encloses the `width: 56` match, then searching only
// inside that span.
//
// QA round 2 (MINOR 5): a style ARRAY splitting the two properties across
// separate objects defeats this too — see the file header. Known, pinned,
// not silently claimed as covered.
//
// S1 replaced all five inline FABs this used to allowlist with <Fab>, whose
// own 56×56 box lives in Fab.tsx (already exempt above) — nothing left to
// grandfather.
const SIZE56_ALLOWLIST: string[] = [];

/**
 * The smallest `{ … }` span in `src` that encloses `pos`, found by walking
 * backwards from `pos` tracking brace depth (skip fully-closed nested pairs)
 * until the enclosing `{` is found, then forward to its matching `}`.
 * Returns null if `pos` isn't inside any braces.
 */
function enclosingBraceRange(src: string, pos: number): [number, number] | null {
  let depth = 0;
  let start = -1;
  for (let i = pos; i >= 0; i--) {
    const ch = src[i];
    if (ch === '}') {
      depth++;
    } else if (ch === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start === -1) return null;
  let depth2 = 0;
  for (let j = start; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth2++;
    else if (ch === '}') {
      depth2--;
      if (depth2 === 0) return [start, j];
    }
  }
  return null;
}

/** Every `width: 56` in `src` paired with a `height: 56` in the SAME
 *  enclosing object literal, as 1-based line numbers. Factored out so the
 *  real scenario and the style-array known-limit fixture scenario share the
 *  exact same production logic rather than two copies that can drift. */
function find56Offenders(src: string): number[] {
  const masked = maskComments(src);
  const lines: number[] = [];
  const widthRe = /\bwidth:\s*56\b/g;
  let m: RegExpExecArray | null;
  while ((m = widthRe.exec(masked))) {
    const range = enclosingBraceRange(masked, m.index);
    const win = range ? masked.slice(range[0], range[1]) : '';
    if (/\bheight:\s*56\b/.test(win)) {
      lines.push(masked.slice(0, m.index).split('\n').length);
    }
  }
  return lines;
}

interface IconAllowlistEntry {
  file: string;
  size: number;
  /** How many occurrences of this size the file is allowed. */
  count: number;
  removedIn: string | null;
  /** Why the site is grandfathered — required once a site was invisible to
   *  the old line-only scan (S0 delivery report / QA round 1). Optional so
   *  the original seed entries (predating this field) still parse. */
  reason?: string;
}

/** A `size={…}` this file's modest evaluator (see header) can't resolve to
 *  a number at all — a function call, an arbitrary local variable. Keyed on
 *  the exact expression text (whitespace-normalized) since there is no
 *  static size to key on instead. */
interface ComputedIconAllowlistEntry {
  file: string;
  expression: string;
  count: number;
  reason: string;
}

function loadIconAllowlist(): IconAllowlistEntry[] {
  const raw = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'icon-size-allowlist.json'), 'utf8');
  return JSON.parse(raw).entries;
}

function loadComputedIconAllowlist(): ComputedIconAllowlistEntry[] {
  const raw = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'icon-size-allowlist.json'), 'utf8');
  return JSON.parse(raw).computedEntries ?? [];
}

function normalizeExpr(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

// ─── Feather tag scanning (scenarios 4 + the BottomSheet wiring guard) ────
//
// QA round 1 fixed matching across newlines but kept `[^>]*?` to find the
// end of the tag, which stops dead at the first '>' — an ordinary
// `accessibilityLabel="Continue >"`, a `testID={x > 0 ? … }`, or a `{/* … >
// … */}` comment hides an otherwise-plain literal with no trace (QA round 2
// MAJOR 1, vector 2). `findJsxTagEnd`/`extractAttrExpr` below find the tag's
// REAL extent by tracking quotes and brace depth instead of stopping at the
// first '>' — general enough to also back the BottomSheet wiring guard,
// which extracts a DIFFERENT attribute (`glass=`) off a DIFFERENT tag
// (`<IconButton>`).

/** The index of the `>` (or the `/` before it) that actually closes a JSX
 *  tag whose name/attributes start at `start` — tracking quotes (so a '>'
 *  inside a string literal doesn't count) and brace depth (so a '>' inside
 *  a `{…}` expression, including one hiding inside a `{/* comment *\/}`,
 *  doesn't count either). Returns -1 if the tag never closes (malformed —
 *  callers skip rather than misreport). */
function findJsxTagEnd(src: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      continue;
    }
    if (ch === '>' && depth === 0) return i;
  }
  return -1;
}

/** The raw text of `attrName={…}` inside `tagSrc` (a single, already-bounded
 *  JSX tag), tracking quotes/brace-depth the same way so the captured
 *  expression is the WHOLE attribute value even if it contains its own
 *  nested `{}` or a `}` inside a string. Null if the tag has no such
 *  attribute (or only has it as bare JSX shorthand, e.g. `<Foo glass />` —
 *  deliberately not resolved to `true`, so a caller checking for "not a
 *  literal true" still fails on that shorthand). */
function extractAttrExpr(tagSrc: string, attrName: string): string | null {
  const m = new RegExp(`\\b${attrName}=\\{`).exec(tagSrc);
  if (!m) return null;
  const exprStart = m.index + m[0].length;
  let depth = 1;
  let quote: string | null = null;
  for (let i = exprStart; i < tagSrc.length; i++) {
    const ch = tagSrc[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return tagSrc.slice(exprStart, i);
    }
  }
  return null;
}

/** Every `<Feather … size={…} … />` in `src` that HAS a `size` prop at all,
 *  found by locating each `<Feather` occurrence, its real tag extent
 *  (`findJsxTagEnd`), and the raw `size={…}` expression text within that
 *  bounded tag (`extractAttrExpr`) — immune to both QA round 1's (multi-
 *  line tags) and QA round 2's (a '>' anywhere before `size=`) bypasses. */
function findFeatherTags(src: string): { raw: string; index: number; line: number }[] {
  const masked = maskComments(src);
  const out: { raw: string; index: number; line: number }[] = [];
  const openRe = /<Feather\b/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(masked))) {
    const tagStart = m.index;
    const tagEnd = findJsxTagEnd(masked, tagStart + m[0].length);
    if (tagEnd === -1) continue;
    const tagSrc = masked.slice(tagStart, tagEnd + 1);
    const raw = extractAttrExpr(tagSrc, 'size');
    if (raw === null) continue;
    const line = masked.slice(0, tagStart).split('\n').length;
    out.push({ raw: raw.trim(), index: tagStart, line });
  }
  return out;
}

// Tiny arithmetic evaluator over +, -, *, /, unary +/-, and parens — enough
// to resolve `ICON.lg + 4` once `ICON.<key>` has been substituted for its
// real numeric value below. Deliberately not a general expression evaluator
// (QA round 2: "don't start an arms race") — anything it can't parse in
// full returns null, which the caller treats as "computed".
function evalArithmetic(expr: string): number | null {
  let i = 0;
  const s = expr;
  const skipWs = () => {
    while (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r') i++;
  };
  const parseNumber = (): number | null => {
    skipWs();
    const start = i;
    while (i < s.length && /[\d.]/.test(s[i]!)) i++;
    if (i === start) return null;
    const n = parseFloat(s.slice(start, i));
    return Number.isNaN(n) ? null : n;
  };
  const parsePrimary = (): number | null => {
    skipWs();
    if (s[i] === '(') {
      i++;
      const v = parseExpr();
      skipWs();
      if (s[i] !== ')') return null;
      i++;
      return v;
    }
    if (s[i] === '-') {
      i++;
      const v = parsePrimary();
      return v === null ? null : -v;
    }
    if (s[i] === '+') {
      i++;
      return parsePrimary();
    }
    return parseNumber();
  };
  const parseTerm = (): number | null => {
    let v = parsePrimary();
    if (v === null) return null;
    for (;;) {
      skipWs();
      if (s[i] === '*' || s[i] === '/') {
        const op = s[i];
        i++;
        const rhs = parsePrimary();
        if (rhs === null) return null;
        v = op === '*' ? v * rhs : v / rhs;
      } else break;
    }
    return v;
  };
  const parseExpr = (): number | null => {
    let v = parseTerm();
    if (v === null) return null;
    for (;;) {
      skipWs();
      if (s[i] === '+' || s[i] === '-') {
        const op = s[i];
        i++;
        const rhs = parseTerm();
        if (rhs === null) return null;
        v = op === '+' ? v + rhs : v - rhs;
      } else break;
    }
    return v;
  };
  const result = parseExpr();
  skipWs();
  if (result === null || i !== s.length) return null;
  return result;
}

/**
 * Resolves a non-literal `size={…}` expression to a number where it's
 * unambiguous from the text alone: a plain integer, an `ICON.sm`/`md`/`lg`
 * reference (substituted for its REAL value from assets.ts, so this can
 * never drift from the token), simple arithmetic over those, and a
 * trailing TS `as Type` assertion stripped. Anything else (a function call,
 * a bare local variable, a ternary) returns null — "computed", not
 * "resolved" (QA round 2 MAJOR 1).
 */
function resolveIconSizeExpr(rawExpr: string): number | null {
  let expr = rawExpr.trim().replace(/\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*\s*$/, '');
  expr = expr.replace(/\bICON\.(sm|md|lg)\b/g, (_all, key: string) => String(ICON[key as 'sm' | 'md' | 'lg']));
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return null;
  return evalArithmetic(expr);
}

/** `value` is the resolved numeric size (a literal digit, or an expression
 *  the modest evaluator above could resolve, e.g. `ICON.lg`, `ICON.lg + 4`,
 *  `20 as number`). Null means "computed": there is no static number here,
 *  only raw text a human must sign off on via the allowlist. */
function classifySizeExpr(raw: string): { value: number | null } {
  if (/^\d+$/.test(raw)) return { value: parseInt(raw, 10) };
  return { value: resolveIconSizeExpr(raw) };
}

// ─── Scenario 6: the retired `surfaceAlt` alias, outside the token files ──
//
// S7 sorted every legacy `surfaceAlt` call site into `controlRaised` /
// `wellRecessed` / `badgeFlat` / `surface` (spec §4 S7). The alias itself
// stays alive in tokens.ts (its per-theme hex) and glassTokens.ts (`clear`'s
// opaque-tier fallback) — both excluded below, not by allowlist entry, since
// they are the token layer the alias is defined in, not a call site.
//
// MenuRow's pressed state (`MenuPanel.tsx`) is the one legitimate exception:
// the style guide's F9 assigns it `surfaceAlt` on purpose (a menu row's
// transient press feedback, distinct from the persistent surface-ladder
// roles the 52 sorted sites needed) — it was never one of the 52 sites S7
// sorted, so it is allowlisted here rather than swept up in the sort.
const TOKEN_FILES = ['tokens.ts', 'glassTokens.ts'].map((name) =>
  path.join(ROOT, 'src', 'theme', name),
);

interface SurfaceAltAllowlistEntry {
  file: string; // relative to ROOT
  value: string;
  count: number;
  reason: string;
}

const SURFACE_ALT_ALLOWLIST: SurfaceAltAllowlistEntry[] = [
  {
    file: path.join('src', 'components', 'ui', 'MenuPanel.tsx'),
    value: 'c.surfaceAlt',
    count: 1,
    reason: "MenuRow pressed state — style guide F9, not one of S7's 52 sorted sites.",
  },
];

defineFeature(feature, (test) => {
  let files: string[];

  const givenFiles = (given: any) =>
    given('every tsx file under app and src', () => {
      files = allTsxFiles();
    });

  const givenTsAndTsxFiles = (given: any) =>
    given('every tsx and ts file under app and src', () => {
      files = allTsAndTsxFiles();
    });

  test('Glass is only ever used through a family component', ({ given, then }) => {
    givenFiles(given);
    then('every "<Glass" use should be inside a glass family component file or the allowlist', () => {
      const offenders: string[] = [];
      for (const f of files) {
        if (GLASS_FAMILY_FILES.includes(f)) continue;
        const rel = path.relative(ROOT, f);
        if (GLASS_CALL_SITE_ALLOWLIST.some((e) => path.join(ROOT, e.file) === f)) continue;
        // Masked (QA round 3): otherwise a comment like "// don't put a
        // <Glass> here" fails the build with no hint it's prose, not code.
        const src = maskComments(fs.readFileSync(f, 'utf8'));
        const count = (src.match(/<Glass(?![A-Za-z])/g) || []).length;
        if (count > 0) offenders.push(`${rel}: ${count}`);
      }
      expect(offenders).toEqual([]);
    });
  });

  test('No call site uses the retired "card" material', ({ given, then }) => {
    givenFiles(given);
    then('no file should use material="card"', () => {
      // Masked (QA round 3) for the same reason as the scenario above.
      const offenders = files
        .filter((f) => /material=(?:"card"|'card')/.test(maskComments(fs.readFileSync(f, 'utf8'))))
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
        for (const line of find56Offenders(src)) {
          offenders.push(`${path.relative(ROOT, f)}:${line}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  test('A width/height 56 pair split across a style array is not detected (known limit)', ({
    given,
    then,
  }) => {
    given('a fixture file with a 56pt box split across a style array', () => {
      // No-op: the fixture is read directly in the `then` below.
    });
    then("the 56pt scan should not flag it — a documented blind spot, not a false pass", () => {
      const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'glass-standard', 'style-array-56.fixture.tsx');
      const src = fs.readFileSync(fixturePath, 'utf8');
      const offenders = find56Offenders(src);
      // Pinning TODAY'S behaviour (a miss), not asserting it's fine — see
      // the file header and MINOR 5 (QA round 2). If this ever starts
      // failing, it means someone taught find56Offenders to see the
      // style-array case — that's a FIX, not a regression, and the right
      // response is to DELETE this scenario and its fixture, not update the
      // expectation below (a custom message here, not just `toEqual([])`,
      // so that reads as the obvious next step rather than a break — QA
      // round 3).
      if (offenders.length > 0) {
        throw new Error(
          'The style-array 56pt case is now detected (offenders at lines ' +
            `${offenders.join(', ')}). If you just taught find56Offenders to ` +
            'see this case: DELETE this scenario and ' +
            'tests/fixtures/glass-standard/style-array-56.fixture.tsx rather ' +
            'than updating the expectation below — it existed only to pin a ' +
            'known limitation, not to set a budget.'
        );
      }
      expect(offenders).toEqual([]);
    });
  });

  test('No Feather icon size outside the ICON scale', ({ given, then }) => {
    givenFiles(given);
    then('no Feather size literal should fall outside ICON values or the icon-size allowlist', () => {
      const ICON_VALUES = new Set([14, 18, 24]);
      const allowlist = loadIconAllowlist();
      const computedAllowlist = loadComputedIconAllowlist();
      const seen = new Map<string, number>();
      const seenComputed = new Map<string, number>();
      const offenders: string[] = [];
      for (const f of files) {
        const rel = path.relative(ROOT, f);
        const src = fs.readFileSync(f, 'utf8');
        for (const { raw, line } of findFeatherTags(src)) {
          const { value } = classifySizeExpr(raw);
          if (value !== null) {
            if (ICON_VALUES.has(value)) continue;
            const key = `${rel}|${value}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
            const allowed = allowlist.some((e) => e.file === rel && e.size === value);
            if (!allowed) offenders.push(`${rel}:${line}: size={${raw}} (= ${value})`);
          } else {
            const expr = normalizeExpr(raw);
            const key = `${rel}|${expr}`;
            seenComputed.set(key, (seenComputed.get(key) ?? 0) + 1);
            const allowed = computedAllowlist.some((e) => e.file === rel && e.expression === expr);
            if (!allowed) offenders.push(`${rel}:${line}: size={${raw}} (computed — not statically resolvable)`);
          }
        }
      }
      // Over budget: the file is grandfathered for N of this size and now
      // has more. Under budget is fine — a step removed one.
      for (const e of allowlist) {
        const n = seen.get(`${e.file}|${e.size}`) ?? 0;
        if (n > e.count) {
          offenders.push(`${e.file}: size={${e.size}} appears ${n}x, allowlisted for ${e.count}`);
        }
      }
      for (const e of computedAllowlist) {
        const n = seenComputed.get(`${e.file}|${e.expression}`) ?? 0;
        if (n > e.count) {
          offenders.push(`${e.file}: computed size "${e.expression}" appears ${n}x, allowlisted for ${e.count}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  const thenFixtureSizeIsDetected = (then: any, fixtureFile: string, expectedSize: number) =>
    then("the scan should still find that Feather's size, off-scale and all", () => {
      const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'glass-standard', fixtureFile);
      const src = fs.readFileSync(fixturePath, 'utf8');
      const matches = findFeatherTags(src);
      expect(matches).toHaveLength(1);
      expect(classifySizeExpr(matches[0]!.raw).value).toBe(expectedSize);
    });

  test('A multi-line Feather size literal is still detected', ({ given, then }) => {
    given('a fixture file with a multi-line off-scale Feather icon', () => {
      // No-op: the fixture is read directly in the `then` below. Kept as a
      // separate step (rather than folded into `then`) to mirror the
      // Given/Then shape of every other scenario in this file.
    });
    // Regression for the exact QA round-1 bug: <Feather ... size={N} .../>
    // wrapped across lines used to match nothing at all — not flagged, and
    // not counted against any allowlist budget either.
    thenFixtureSizeIsDetected(then, 'multiline-feather.fixture.tsx', 20);
  });

  test("A stray '>' before size does not hide an off-scale literal", ({ given, then }) => {
    given("a fixture file with a stray '>' character before a Feather's size", () => {
      // No-op: the fixture is read directly in the `then` below.
    });
    // Regression for QA round 2 MAJOR 1 vector 2: an ordinary '>' anywhere
    // between `<Feather` and `size=` (a quoted accessibilityLabel here) used
    // to stop the old tag scan dead, hiding an otherwise-plain literal.
    thenFixtureSizeIsDetected(then, 'gt-character-feather.fixture.tsx', 20);
  });

  test('A non-literal Feather size is flagged as computed, not silently ignored', ({ given, then }) => {
    given('a fixture file with a non-literal Feather size expression', () => {
      // No-op: the fixture is read directly in the `then` below.
    });
    then('the scan should report it as a computed size needing an allowlist entry', () => {
      const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'glass-standard', 'computed-size-feather.fixture.tsx');
      const src = fs.readFileSync(fixturePath, 'utf8');
      const matches = findFeatherTags(src);
      // Regression for QA round 2 MAJOR 1 vector 1: a non-literal size (an
      // arbitrary local variable here, `Math.round(...)` in the wild at
      // app/welcome.tsx:319) used to produce zero matches at all — not
      // flagged, not counted against any budget. It must now show up as a
      // match whose value can't be resolved, so it forces an allowlist
      // decision rather than passing invisibly.
      expect(matches).toHaveLength(1);
      expect(classifySizeExpr(matches[0]!.raw).value).toBeNull();
    });
  });

  test("BottomSheet's close IconButton passes a gated glass prop, not a literal", ({ given, then }) => {
    let src: string;
    given("BottomSheet.tsx's source", () => {
      src = fs.readFileSync(path.join(ROOT, 'src', 'components', 'ui', 'BottomSheet.tsx'), 'utf8');
    });
    // QA round 2 MAJOR 2: the R9 mount gate has a domain-level regression
    // test (glass-mount-gate.feature) for the DECISION, but nothing guarded
    // the WIRING at BottomSheet's own call site — a future edit swapping
    // `glass={showGlass}` for bare `glass` or `glass={true}` would leave
    // every other gate green. This is that guard.
    then('its close IconButton\'s "glass" prop should not be a literal true or false', () => {
      const masked = maskComments(src);
      const labelIdx = masked.indexOf('accessibilityLabel="Close"');
      expect(labelIdx).toBeGreaterThan(-1);
      const tagStart = masked.lastIndexOf('<IconButton', labelIdx);
      expect(tagStart).toBeGreaterThan(-1);
      const tagEnd = findJsxTagEnd(masked, tagStart + '<IconButton'.length);
      expect(tagEnd).toBeGreaterThan(-1);
      const tagSrc = masked.slice(tagStart, tagEnd + 1);
      const glassExpr = extractAttrExpr(tagSrc, 'glass');
      // Null also catches bare shorthand (`<IconButton glass ... />`, which
      // means `glass={true}`) since that never matches `glass={`.
      expect(glassExpr).not.toBeNull();
      expect(glassExpr!.trim()).not.toBe('true');
      expect(glassExpr!.trim()).not.toBe('false');
    });
  });

  test("An apostrophe in prose doesn't blind a later real comment", ({ given, then }) => {
    given('a fixture file with an apostrophe in a comment followed by another comment', () => {
      // No-op: the fixture is read directly in the `then` below.
    });
    then('the masker should still blank the later comment', () => {
      const fixturePath = path.join(
        ROOT,
        'tests',
        'fixtures',
        'glass-standard',
        'apostrophe-then-comment.fixture.tsx',
      );
      const src = fs.readFileSync(fixturePath, 'utf8');
      const masked = maskComments(src);
      // Regression for QA round 2: every `'` treated as a delimiter meant
      // "Apple's" opened a quote state that never closed, so this SECOND,
      // perfectly ordinary comment never got masked either.
      expect(masked).not.toContain('THIS_REAL_COMMENT_MUST_BE_MASKED');
    });
  });

  test('A single-quoted string containing // is not mistaken for a comment', ({ given, then }) => {
    given('a fixture file with a single-quoted URL followed by a real trailing comment', () => {
      // No-op: the fixture is read directly in the `then` below.
    });
    then('the masker should preserve the string and still blank the trailing comment', () => {
      const fixturePath = path.join(
        ROOT,
        'tests',
        'fixtures',
        'glass-standard',
        'quoted-url-then-comment.fixture.tsx',
      );
      const src = fs.readFileSync(fixturePath, 'utf8');
      const masked = maskComments(src);
      // Regression for QA round 3: dropping `'` as a delimiter entirely
      // meant the `//` inside this URL was mistaken for a comment start,
      // masking the string's own content too.
      expect(masked).toContain('https://example.com/path');
      expect(masked).not.toContain('THIS_REAL_COMMENT_MUST_BE_MASKED');
    });
  });

  test('No call site outside the token files uses the retired surfaceAlt alias', ({ given, then }) => {
    givenTsAndTsxFiles(given);
    then(
      'no "bg-surfaceAlt", "c.surfaceAlt" or "colors.surfaceAlt" use should appear outside tokens.ts, glassTokens.ts or the allowlist',
      () => {
        const PATTERN = /\bbg-surfaceAlt\b|\bc\.surfaceAlt\b|\bcolors\.surfaceAlt\b/g;
        const seen = new Map<string, number>();
        const offenders: string[] = [];
        for (const f of files) {
          if (TOKEN_FILES.includes(f)) continue;
          const rel = path.relative(ROOT, f);
          // Masked (QA round 4): this was the last scan still reading raw
          // source — the style guide's own "dark coincidence" rule (`
          // controlRaised` = `surfaceAlt` in dark) invites exactly the kind
          // of prose comment that trips it (AmountKeypad.tsx:114,119
          // already argues that point in a comment).
          const src = maskComments(fs.readFileSync(f, 'utf8'));
          const lines = src.split('\n');
          lines.forEach((line, i) => {
            const re = new RegExp(PATTERN);
            let m: RegExpExecArray | null;
            while ((m = re.exec(line))) {
              const value = m[0];
              const lineNo = i + 1;
              const key = `${rel}|${value}`;
              seen.set(key, (seen.get(key) ?? 0) + 1);
              const allowed = SURFACE_ALT_ALLOWLIST.some((e) => e.file === rel && e.value === value);
              if (!allowed) offenders.push(`${rel}:${lineNo}: ${value}`);
            }
          });
        }
        // Over budget: the file is grandfathered for N of this value and now
        // has more. Under budget is fine — a later step removed one.
        for (const e of SURFACE_ALT_ALLOWLIST) {
          const n = seen.get(`${e.file}|${e.value}`) ?? 0;
          if (n > e.count) {
            offenders.push(`${e.file}: ${e.value} appears ${n}x, allowlisted for ${e.count}`);
          }
        }
        expect(offenders).toEqual([]);
      },
    );
  });
});
