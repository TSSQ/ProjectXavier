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
 * Wired into `npm run eval` (see run-eval.mjs / package.json) so the two
 * copies can't silently diverge even on a machine without Foundation Models
 * or a Swift toolchain.
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

/** Collapse all whitespace runs (including newlines) to a single space and
 *  trim — the block is vendored verbatim in content, but the probe's copy is
 *  un-nested (one indentation level shallower) than the binding's, so a
 *  byte-for-byte comparison would false-positive on indentation alone. This
 *  still catches any REAL content drift (added/removed/reordered lines,
 *  changed logic, changed literals). */
function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
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
        'ios/AppleLLMImpl.swift). Re-vendor the struct verbatim into probe.swift and update its ' +
        'version note.\n'
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
}

main();
