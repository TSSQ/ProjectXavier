#!/usr/bin/env node
/**
 * Thin subprocess helper (dev tooling — never ships) run under `tsx` by
 * `evals/run-eval.mjs`'s `getRoutedIds` — see that function's own doc
 * comment for WHY this is a separate subprocess rather than a plain import:
 * `run-eval.mjs` runs under plain `node`, but `detectIntent`
 * (`src/domain/intentGate.ts`) is TypeScript, so getting the REAL app
 * routing decision (not a re-implementation) means shelling out to `tsx`,
 * the same way `evals/engines/run_node.mjs` is shelled out to for an
 * engine's own parse result.
 *
 * Usage: `npx tsx evals/fm/intent-routing.mjs <cases.jsonl>` — reads a
 * JSONL file of `{ id, text, ... }` cases (one per line; any dataset-case
 * shape works, only `id`/`text` are read) and prints a JSON array of
 * `{ id, intent, routed }` to stdout, where `intent` is `detectIntent`'s
 * raw `UnifiedIntent` return (`'query'|'create'|'update'|'delete'|'tx_op'|
 * null`) and `routed` is `intent !== null` — i.e. whether the REAL app
 * would divert this text to a different handler before the parser ever
 * sees it (see evals/gates.mjs's `computeAfterRoutingRefusal`).
 */
import { readFileSync } from 'node:fs';
import { detectIntent } from '../../src/domain/intentGate.ts';

const datasetPath = process.argv[2];
if (!datasetPath) {
  console.error('usage: npx tsx evals/fm/intent-routing.mjs <cases.jsonl>');
  process.exit(1);
}

const cases = readFileSync(datasetPath, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const out = cases.map((c) => {
  const intent = detectIntent(c.text);
  return { id: c.id, intent, routed: intent !== null };
});

process.stdout.write(JSON.stringify(out));
