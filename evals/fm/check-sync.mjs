#!/usr/bin/env node
/**
 * Contract-sync guard for the FM Swift probe (dev tooling — never ships).
 *
 * Step 1a.2 replaced the probe's hand-mirrored prompt/schema STRINGS (step
 * 1a's `@Generable` struct + `.describe()`/instructions copies) with the
 * app's real dynamic-schema path: `evals/fm/probe.swift` now vendors
 * `AppleLLMSchemaParser` VERBATIM from the installed
 * `@react-native-ai/apple` binding (`node_modules/@react-native-ai/apple/ios/
 * AppleLLMImpl.swift`) — the exact code the app's own binding runs to turn a
 * JSON Schema into a `DynamicGenerationSchema`. There is no longer a
 * prompt/schema STRING to compare (the probe now receives instructions/
 * prompt/schema over stdin, built by the real TS functions at eval time —
 * see `evals/engines/run_node.mjs`'s `runFM`).
 *
 * What CAN still silently drift is the VENDORED CODE itself: an
 * `@react-native-ai/apple` upgrade could change how `AppleLLMSchemaParser`
 * converts a JSON Schema into a `GenerationSchema` without anyone noticing,
 * since the probe's copy doesn't rebuild from node_modules. So this guard now
 * extracts the `struct AppleLLMSchemaParser { ... }` block from BOTH
 * `probe.swift` and the installed binding's `AppleLLMImpl.swift`,
 * whitespace-normalizes each (the probe's copy is un-nested — no longer
 * inside `AppleLLMImpl`'s class body — so indentation differs even when the
 * code doesn't), and fails loudly on any other difference.
 *
 * A SECOND guard (`checkAnchors`/`ANCHORS` below) covers
 * behaviour that lives OUTSIDE that one struct: `includeSchemaInPrompt:
 * true`, `.greedy` as the default sampling mode, the session being built
 * from a `Transcript`, `toModelMessages()`'s output shape, and `ai-sdk.ts`'s
 * `doGenerate` still passing `responseFormat.schema` through — each a
 * stable substring anchor in the installed binding's source, failing loudly
 * if any of them move.
 *
 * Wired into `npm run eval` (see run-eval.mjs / package.json) so the two
 * copies (and the anchors) can't silently diverge even on a machine without
 * Foundation Models or a Swift toolchain.
 *
 * Usage: node evals/fm/check-sync.mjs   (exits 0 = in sync, 1 = drift)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const BINDING_PATH = path.join(
  REPO_ROOT,
  'node_modules',
  '@react-native-ai',
  'apple',
  'ios',
  'AppleLLMImpl.swift'
);
const PROBE_PATH = path.join(__dirname, 'probe.swift');
// The app's real "react-native" entry point (see the package's package.json
// — Metro resolves `"react-native": "src/index"` ahead of `"main"`/
// `"module"`, so THIS is the file that actually ships, not the precompiled
// `lib/**`). Anchor (e) below checks against this file.
const AI_SDK_SRC_PATH = path.join(
  REPO_ROOT,
  'node_modules',
  '@react-native-ai',
  'apple',
  'src',
  'ai-sdk.ts'
);

const STRUCT_MARKER = 'struct AppleLLMSchemaParser {';

/** Scan `source` starting at `openIdx` (source[openIdx] must be `open`) and
 *  return the index of the matching `close`, tracking depth and skipping over
 *  quoted string literals/line comments so braces inside them don't throw off
 *  the count. */
function matchBrace(source, openIdx) {
  let depth = 0;
  let inString = false;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (source.startsWith('//', i)) {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced braces starting at index ${openIdx}`);
}

/** Extract the `struct AppleLLMSchemaParser { ... }` block (including the
 *  `struct` line's own leading modifiers, e.g. `@available(iOS 26, *)`, up to
 *  — but not including — that annotation line, since the probe's copy may or
 *  may not repeat it identically positioned) from `source`. Returns the block
 *  body between (and including) the braces. */
function extractSchemaParserBlock(source, label) {
  const markerIdx = source.indexOf(STRUCT_MARKER);
  if (markerIdx === -1) {
    throw new Error(`"${STRUCT_MARKER}" not found in ${label}`);
  }
  const openBraceIdx = markerIdx + STRUCT_MARKER.length - 1;
  const closeBraceIdx = matchBrace(source, openBraceIdx);
  return source.slice(markerIdx, closeBraceIdx + 1);
}

/** Generic version of `extractSchemaParserBlock`: find `marker` in `source`,
 *  then the first `{` at/after it, then its matching `}` (same
 *  brace-matching as the struct extractor, so quoted braces/line comments
 *  don't throw off the count). Used to SCOPE an anchor needle to one
 *  specific method body (e.g. `doGenerate`) rather than matching anywhere in
 *  the whole file — `ai-sdk.ts`'s `doGenerate`/`doStream` share near-
 *  identical `responseFormat.schema` lines, so an unscoped substring check
 *  can't tell a real `doGenerate` drift from an unrelated `doStream` edit.
 *
 *  `matchBrace` only understands `"`-quoted strings and `//` line comments —
 *  it has no notion of TypeScript's template literals, single-quoted
 *  strings, regex literals, or `/* ... *\/` block comments. Scoping a
 *  TypeScript file (as anchor (e) below does, against `ai-sdk.ts`) can
 *  therefore mis-close on a brace hiding inside one of those constructs and
 *  silently swallow the NEXT method's body too. `assertScopedTo` lets a
 *  caller name a marker that must NOT appear in the extracted block — the
 *  caller's own proof that the scope didn't overrun — and fails loudly
 *  (rather than returning a silently too-large block) when it does. */
function extractBlockAfterMarker(source, marker, label, assertNotContaining) {
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error(`"${marker}" not found in ${label}`);
  }
  const openBraceIdx = source.indexOf('{', markerIdx);
  if (openBraceIdx === -1) {
    throw new Error(`no "{" found after "${marker}" in ${label}`);
  }
  const closeBraceIdx = matchBrace(source, openBraceIdx);
  const block = source.slice(markerIdx, closeBraceIdx + 1);
  if (assertNotContaining && block.includes(assertNotContaining)) {
    throw new Error(
      `scoping to "${marker}" in ${label} overran into "${assertNotContaining}" — matchBrace's quote/` +
        `comment handling doesn't understand TypeScript template literals/regex/block comments, so its ` +
        `brace count can mis-close on a real file; re-scope with a tighter or later marker.`
    );
  }
  return block;
}

/** Collapse all whitespace runs (including newlines) to a single space and
 *  trim — the block is vendored verbatim in content, but the probe's copy is
 *  un-nested (one indentation level shallower) than the binding's, so a
 *  byte-for-byte comparison would false-positive on indentation alone. This
 *  still catches any REAL content drift (added/removed/reordered lines,
 *  changed logic, changed literals). */
function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Anchor checks: the vendored-struct diff above only guards
 * `AppleLLMSchemaParser` itself. Several OTHER binding behaviours the probe
 * (and the app's real `deviceParse.ts`/`run_node.mjs` call chain) silently
 * depends on live entirely OUTSIDE that struct — a binding upgrade could
 * change any of these without the vendored-struct diff ever noticing. Each
 * anchor is a stable substring whose disappearance/change means the
 * assumption it names may no longer hold; this is intentionally a coarse
 * "did this exact wording move" check, not a semantic one — its job is to
 * fail LOUDLY on drift, not to silently pass a rewritten equivalent.
 */
const ANCHORS = [
  {
    // `includeSchemaInPrompt: true` ALSO appears in
    // `generateStream`'s `streamResponse(...)` call (~line 125) — the app's
    // real call chain (generateObject -> doGenerate -> generateText) never
    // goes through `generateStream`/streaming at all, so an unscoped
    // substring match here would stay green even if THIS specific call
    // dropped `includeSchemaInPrompt`, as long as the unrelated streaming
    // copy still had it. Anchor on the FULL non-streaming `respond(...)`
    // call line instead, which is unique in the file.
    label: '(a) generateText still calls session.respond(to:schema:includeSchemaInPrompt:options:) with includeSchemaInPrompt: true',
    file: BINDING_PATH,
    needle:
      'session.respond(to: userPrompt, schema: generationSchema, includeSchemaInPrompt: true, options: generationOptions)',
  },
  {
    label: '(b) .greedy is still the default sampling mode in createGenerationOptions',
    file: BINDING_PATH,
    needle: 'var samplingMode: GenerationOptions.SamplingMode = .greedy',
  },
  {
    label: '(c) the session is still built from a Transcript',
    file: BINDING_PATH,
    needle: 'return (Transcript(entries: entries), userPrompt)',
  },
  {
    // Tightened from the bare function signature to the exact expression
    // `probe.swift`'s `extractRawModelText` mirrors — `toModelMessages()`'s
    // `.response` case building `"text": String(describing:
    // response.segments.last!)`: if the binding ever wrapped/renamed/
    // reordered this, the probe's raw-text output would silently stop
    // matching what the app's real `toModelMessages()` returns, and the
    // function-signature-only anchor wouldn't have caught it.
    label: '(d) toModelMessages()\'s .response case still builds "text": String(describing: response.segments.last!)',
    file: BINDING_PATH,
    needle: '"text": String(describing: response.segments.last!)',
  },
  {
    // `doGenerate` and `doStream` both build `schema:
    // options.responseFormat?.type === 'json' ? options.responseFormat.schema
    // : undefined` — an unscoped substring match can't tell a real drift in
    // `doGenerate` (the one the app's `generateObject` path actually runs)
    // from an unrelated edit only to `doStream`. Scoped to the `doGenerate`
    // method body via `extractBlockAfterMarker` below, which itself asserts
    // (`assertNotContaining`) that the scoped block never swallows
    // `async doStream` — see that function's own doc comment for why a
    // TypeScript file needs that extra check.
    label: "(e) ai-sdk.ts's doGenerate (not doStream) still passes responseFormat.schema through",
    file: AI_SDK_SRC_PATH,
    scopeMarker: 'async doGenerate(options: LanguageModelV3CallOptions) {',
    assertNotContaining: 'async doStream',
    needle: "options.responseFormat?.type === 'json'",
  },
];

function checkAnchors() {
  const failures = [];
  for (const { label, file, needle, scopeMarker, assertNotContaining } of ANCHORS) {
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch (e) {
      failures.push(`${label}: could not read ${path.relative(REPO_ROOT, file)} (${e.message})`);
      continue;
    }
    let haystack = source;
    if (scopeMarker) {
      try {
        haystack = extractBlockAfterMarker(
          source,
          scopeMarker,
          path.relative(REPO_ROOT, file),
          assertNotContaining
        );
      } catch (e) {
        failures.push(`${label}: ${e.message}`);
        continue;
      }
    }
    if (!haystack.includes(needle)) {
      failures.push(
        `${label}: expected substring not found in ${path.relative(REPO_ROOT, file)}` +
          `${scopeMarker ? ` (scoped to "${scopeMarker}")` : ''}:\n    "${needle}"`
      );
    }
  }
  if (failures.length > 0) {
    console.error(
      'check-sync: FAIL — one or more behavior anchors in the installed @react-native-ai/apple ' +
        "binding have drifted from what the probe/eval harness assumes. A binding upgrade changed " +
        'something the vendored-struct diff above does not cover — re-verify the probe/run_node.mjs ' +
        'against the new binding source, then update the anchor (and this comment) to match.\n'
    );
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`check-sync: PASS — all ${ANCHORS.length} behavior anchors still hold.`);
}

function main() {
  const binding = readFileSync(BINDING_PATH, 'utf8');
  const probe = readFileSync(PROBE_PATH, 'utf8');

  const bindingBlock = extractSchemaParserBlock(binding, path.relative(REPO_ROOT, BINDING_PATH));
  const probeBlock = extractSchemaParserBlock(probe, path.relative(REPO_ROOT, PROBE_PATH));

  const bindingNorm = normalizeWhitespace(bindingBlock);
  const probeNorm = normalizeWhitespace(probeBlock);

  if (bindingNorm !== probeNorm) {
    console.error(
      'check-sync: FAIL — probe.swift\'s vendored AppleLLMSchemaParser no longer matches the ' +
        'installed @react-native-ai/apple binding\'s copy (node_modules/@react-native-ai/apple/' +
        'ios/AppleLLMImpl.swift). The most likely cause is an unpatched install: this repo ships ' +
        'patches/@react-native-ai+apple+*.patch (the deterministic "x-order" field-order patch, ' +
        'applied via patch-package\'s postinstall hook) — run `npm install` to apply patches/ and ' +
        'try again. If the installed binding genuinely changed upstream, re-vendor the struct ' +
        'verbatim into probe.swift (reapplying the same patch logic) and update its version note.\n'
    );
    // A short diff aid: first differing character, with surrounding context.
    let i = 0;
    while (i < bindingNorm.length && i < probeNorm.length && bindingNorm[i] === probeNorm[i]) i++;
    console.error(`First divergence at normalized offset ${i}:`);
    console.error(`  binding: …${bindingNorm.slice(Math.max(0, i - 40), i + 40)}…`);
    console.error(`  probe:   …${probeNorm.slice(Math.max(0, i - 40), i + 40)}…`);
    process.exit(1);
  }

  console.log(
    `check-sync: PASS — probe.swift's vendored AppleLLMSchemaParser matches ` +
      `${path.relative(REPO_ROOT, BINDING_PATH)}.`
  );

  checkAnchors();
}

main();
