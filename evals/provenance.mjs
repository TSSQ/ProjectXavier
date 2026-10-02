/**
 * Provenance hashes (dev tooling — never ships): what a result was measured
 * AGAINST. Recorded in every artifact (and the label hashes in a reconstructed
 * raw header) so a later comparison or re-score can tell when the labels or
 * the parse prompt have moved underneath it.
 *
 *  - `expectedHash(expected)`  one case's label (key-order independent).
 *  - `labelHashes(cases)`      `{ id: expectedHash }` for a case list.
 *  - `datasetLabelSha(cases)`  one hash over a whole case list's ids + labels.
 *  - `parsePromptSha(root)`    hash of the parse-prompt SOURCE: the on-device
 *                              prompt plus the BYOK engine files.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const DEVICE_PROMPT = 'src/domain/deviceParsePrompt.ts';
const BYOK_ENGINES_DIR = 'src/features/ai/engines';

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** JSON with object keys sorted at every level, so field order never matters. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function expectedHash(expected) {
  return sha(canonical(expected ?? null)).slice(0, 16);
}

export function labelHashes(cases) {
  return Object.fromEntries(cases.map((c) => [c.id, expectedHash(c.expected)]));
}

/** One hash over `[id, label]` for every case, order independent. */
export function datasetLabelSha(cases) {
  const lines = cases.map((c) => `${c.id}\t${expectedHash(c.expected)}`).sort();
  return sha(lines.join('\n')).slice(0, 16);
}

/** The files whose text IS the parse prompt: the on-device prompt and every
 *  non-test source file of the BYOK engines (their prompts live there). */
export function parsePromptFiles(repoRoot = REPO_ROOT) {
  const engines = readdirSync(path.join(repoRoot, BYOK_ENGINES_DIR))
    .filter((f) => f.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(f))
    .sort()
    .map((f) => `${BYOK_ENGINES_DIR}/${f}`);
  return [DEVICE_PROMPT, ...engines];
}

export function parsePromptSha(repoRoot = REPO_ROOT) {
  const h = createHash('sha256');
  for (const rel of parsePromptFiles(repoRoot)) {
    h.update(`${rel}\n${readFileSync(path.join(repoRoot, rel), 'utf8')}\n`);
  }
  return h.digest('hex').slice(0, 16);
}

/** The provenance block every artifact carries for the cases it was scored on. */
export function artifactProvenance(cases, { parsePrompt = parsePromptSha() } = {}) {
  return { datasetLabelSha: datasetLabelSha(cases), caseCount: cases.length, parsePromptSha: parsePrompt };
}

/** Throws a clear error when a RECONSTRUCTED raw file's labels have changed
 *  since it was rebuilt. A reconstruction keeps the model's recorded output
 *  only for fields it got wrong; for the fields it got right it stores the
 *  label value of that day. Re-scoring after a label change on such a field
 *  would silently score the new label against the old label's value, so it is
 *  refused rather than guessed. No-op for a genuine (non-reconstructed) file. */
export function assertReconstructedLabelsCurrent(header, cases, file = 'raw file') {
  if (!header.reconstructed) return;
  if (!header.labelHashes) {
    throw new Error(
      `${file}: reconstructed from lossy data but its header has no labelHashes, so label drift cannot be ruled out; refusing to score it.`
    );
  }
  const changed = cases
    .filter((c) => c.id in header.labelHashes && header.labelHashes[c.id] !== expectedHash(c.expected))
    .map((c) => c.id);
  if (changed.length) {
    throw new Error(
      `${file}: the label changed since this reconstructed file was built, for ${changed.length} case(s): ${changed.join(', ')}. ` +
        `A reconstruction holds the label's own value for every field the model got right, so a changed label cannot be scored from it. ` +
        `Re-run the engine, or rebuild the file (evals/reconstruct-raw.mjs) from the original artifact against the matching dataset.`
    );
  }
}
