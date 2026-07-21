#!/usr/bin/env node
/**
 * Contract-sync guard for the FM Swift probe (dev tooling — never ships).
 *
 * `evals/fm/probe.swift` hand-mirrors `src/domain/deviceParsePrompt.ts`'s
 * `deviceParseSchema` `.describe()` strings and `buildDeviceParseInstructions()`
 * output VERBATIM (Swift has no way to import the TS module directly — see
 * evals/README.md "Wiring the FM Swift probe"). This script is the backstop
 * that catches the two copies drifting apart: it extracts the canonical
 * string literals from BOTH files by parsing their source text (no TS
 * execution, no Swift compile — pure string comparison, runs with plain
 * `node`) and fails loudly on ANY mismatch, printing exactly which string
 * diverged.
 *
 * Wired into `npm run eval` (see run-eval.mjs / package.json) so the two
 * prompt copies can't silently diverge even on a machine without Foundation
 * Models or a Swift toolchain.
 *
 * Usage: node evals/fm/check-sync.mjs   (exits 0 = in sync, 1 = drift)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TS_PATH = path.join(__dirname, '..', '..', 'src', 'domain', 'deviceParsePrompt.ts');
const SWIFT_PATH = path.join(__dirname, 'probe.swift');

/** The `deviceParseSchema` field order (also the probe.swift struct's field
 *  order) — used only to give a stable, readable report; the actual
 *  comparison is by field name, not position. */
const FIELDS = [
  'amount', 'currency', 'type', 'category', 'payee', 'account', 'note',
  'occurredOn', 'confidence', 'pending',
];

/** Quoted string-literal tokens (single- or double-quoted, escape-aware),
 *  shared by both the TS and Swift extractors below — both languages use the
 *  same `\"`/`\\` escaping for the characters these files actually contain. */
const STRING_LITERAL_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;

/** Turn a matched literal (including its surrounding quotes) into its real
 *  string value. */
function decodeLiteral(raw) {
  const quote = raw[0];
  const inner = raw.slice(1, -1);
  return inner.replace(/\\(.)/g, (_, ch) => {
    if (ch === quote) return quote;
    if (ch === '\\') return '\\';
    if (ch === 'n') return '\n';
    if (ch === 't') return '\t';
    return ch;
  });
}

/** Strip line comments and block comments from `source`, leaving string
 *  literals untouched (byte-for-byte, including their quotes/escapes) — several of
 *  deviceParsePrompt.ts's inline `//` comments quote example text (e.g.
 *  `("12.50", "coffee 4")`), which would otherwise be mistaken for real
 *  schema/instructions string literals by the extractors below. */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      out += ch;
      while (j < source.length) {
        if (source[j] === '\\') {
          out += source[j] + (source[j + 1] ?? '');
          j += 2;
          continue;
        }
        out += source[j];
        if (source[j] === quote) { j += 1; break; }
        j += 1;
      }
      i = j;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (two === '/*') {
      const endIdx = source.indexOf('*/', i + 2);
      i = endIdx === -1 ? source.length : endIdx + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Scan `source` starting at `openIdx` (source[openIdx] must be `open`) and
 *  return the index of the matching `close`, tracking depth and skipping over
 *  quoted string literals (so parens/brackets *inside* a description string,
 *  e.g. category's "(e.g. ...)", don't throw off the count). */
function matchDelimiter(source, openIdx, open, close) {
  let depth = 0;
  let inString = null; // the quote char currently inside, or null
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') { i++; continue; } // skip escaped char
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced ${open}${close} starting at index ${openIdx}`);
}

/** Concatenate every quoted string literal found in `source.slice(from, to)`,
 *  in order, with `join` between them (`''` for TS `+`-concatenation /
 *  Swift `+`-concatenation, `' '` for a `.join(' ')`/`.joined(separator: " ")`
 *  array). */
function concatLiterals(source, from, to, join) {
  const slice = source.slice(from, to);
  const matches = slice.match(STRING_LITERAL_RE) ?? [];
  return matches.map(decodeLiteral).join(join);
}

// ─── TS side ─────────────────────────────────────────────────────────────

function extractTsSchemaDescriptions(ts) {
  const objIdx = ts.indexOf('export const deviceParseSchema = z.object({');
  if (objIdx === -1) throw new Error('deviceParseSchema not found in deviceParsePrompt.ts');
  const openBraceIdx = ts.indexOf('{', objIdx);
  const closeBraceIdx = matchDelimiter(ts, openBraceIdx, '{', '}');
  const block = ts.slice(openBraceIdx, closeBraceIdx + 1);

  // Field starts: 2-space-indented `name: z` inside the object block.
  const fieldStartRe = /\n {2}(\w+): z\b/g;
  const starts = [];
  let m;
  while ((m = fieldStartRe.exec(block))) {
    starts.push({ name: m[1], index: m.index });
  }

  const descriptions = {};
  for (let i = 0; i < starts.length; i++) {
    const { name, index } = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : block.length;
    const fieldSrc = block.slice(index, end);
    const describeIdx = fieldSrc.indexOf('.describe(');
    if (describeIdx === -1) continue; // no .describe() on this field — skip
    const openParenIdx = fieldSrc.indexOf('(', describeIdx);
    const closeParenIdx = matchDelimiter(fieldSrc, openParenIdx, '(', ')');
    descriptions[name] = concatLiterals(fieldSrc, openParenIdx + 1, closeParenIdx, '');
  }
  return descriptions;
}

function extractTsInstructions(ts) {
  const fnIdx = ts.indexOf('export function buildDeviceParseInstructions(): string {');
  if (fnIdx === -1) throw new Error('buildDeviceParseInstructions not found in deviceParsePrompt.ts');
  const returnIdx = ts.indexOf('return [', fnIdx);
  const openBracketIdx = ts.indexOf('[', returnIdx);
  const closeBracketIdx = matchDelimiter(ts, openBracketIdx, '[', ']');
  return concatLiterals(ts, openBracketIdx + 1, closeBracketIdx, ' ');
}

// ─── Swift side ──────────────────────────────────────────────────────────

function extractSwiftGuideDescriptions(swift) {
  const descriptions = {};
  const guideRe = /@Guide\(description:\s*/g;
  let m;
  while ((m = guideRe.exec(swift))) {
    const openParenIdx = swift.indexOf('(', m.index);
    const closeParenIdx = matchDelimiter(swift, openParenIdx, '(', ')');
    const description = concatLiterals(swift, openParenIdx + 1, closeParenIdx, '');

    // Field name: the first `var`/`let` declaration after the closing paren.
    const tail = swift.slice(closeParenIdx, closeParenIdx + 200);
    const fieldMatch = /\b(?:var|let)\s+(\w+)\s*:/.exec(tail);
    if (!fieldMatch) throw new Error(`@Guide at index ${m.index} has no following var/let declaration`);
    descriptions[fieldMatch[1]] = description;
  }
  return descriptions;
}

// `matchDelimiter` assumes `open !== close` (it tracks depth via separate
// open/close checks); a `"`-delimited string needs its own single-quote-type
// matcher instead, which also lets Swift's `let deviceParseInstructions = "…"`
// stay a single unbroken literal (matching the fully-assembled TS string).
function matchClosingQuote(source, openIdx) {
  for (let i = openIdx + 1; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === '"') return i;
  }
  throw new Error(`unterminated string starting at index ${openIdx}`);
}

// ─── main ────────────────────────────────────────────────────────────────

function main() {
  const ts = stripComments(readFileSync(TS_PATH, 'utf8'));
  const swift = stripComments(readFileSync(SWIFT_PATH, 'utf8'));

  const tsDescriptions = extractTsSchemaDescriptions(ts);
  const tsInstructions = extractTsInstructions(ts);
  const swiftDescriptions = extractSwiftGuideDescriptions(swift);
  const declIdx = swift.indexOf('let deviceParseInstructions = ');
  if (declIdx === -1) throw new Error('deviceParseInstructions not found in probe.swift');
  const quoteIdx = swift.indexOf('"', declIdx);
  const closeQuoteIdx = matchClosingQuote(swift, quoteIdx);
  const swiftInstructions = decodeLiteral(swift.slice(quoteIdx, closeQuoteIdx + 1));

  const problems = [];

  const tsFields = new Set(Object.keys(tsDescriptions));
  const swiftFields = new Set(Object.keys(swiftDescriptions));
  for (const f of FIELDS) {
    if (!tsFields.has(f)) problems.push(`field "${f}" has no .describe() in deviceParsePrompt.ts`);
    if (!swiftFields.has(f)) problems.push(`field "${f}" has no @Guide in probe.swift`);
  }
  for (const f of tsFields) if (!FIELDS.includes(f)) problems.push(`unexpected .describe()'d field "${f}" in deviceParsePrompt.ts (not in this guard's FIELDS list)`);
  for (const f of swiftFields) if (!FIELDS.includes(f)) problems.push(`unexpected @Guide field "${f}" in probe.swift (not in this guard's FIELDS list)`);

  for (const f of FIELDS) {
    if (!tsFields.has(f) || !swiftFields.has(f)) continue;
    if (tsDescriptions[f] !== swiftDescriptions[f]) {
      problems.push(
        `field "${f}" description drift:\n` +
          `  deviceParsePrompt.ts: ${JSON.stringify(tsDescriptions[f])}\n` +
          `  probe.swift:          ${JSON.stringify(swiftDescriptions[f])}`
      );
    }
  }

  if (tsInstructions !== swiftInstructions) {
    problems.push(
      `instructions drift:\n` +
        `  deviceParsePrompt.ts: ${JSON.stringify(tsInstructions)}\n` +
        `  probe.swift:          ${JSON.stringify(swiftInstructions)}`
    );
  }

  if (problems.length > 0) {
    console.error(`check-sync: FAIL — ${problems.length} drift(s) between probe.swift and deviceParsePrompt.ts:\n`);
    for (const p of problems) console.error(`- ${p}\n`);
    process.exit(1);
  }

  console.log(
    `check-sync: PASS — ${FIELDS.length} field descriptions + instructions match between ` +
      `${path.relative(process.cwd(), SWIFT_PATH)} and ${path.relative(process.cwd(), TS_PATH)}.`
  );
}

main();
