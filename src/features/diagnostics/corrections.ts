/**
 * The on-device corrections file — the I/O half of "This parse was wrong"
 * (docs/design/parse-correction-loop-spec.md; pure builder/validator in
 * src/domain/parseCorrection.ts).
 *
 * One JSONL file in the app's own documents directory
 * (`Paths.document/parse-corrections.jsonl`), one eval-dataset-shaped case per
 * line, appended to on each report. Everything stays on the device: the only
 * way a line leaves is the user tapping "Share corrections file" in
 * Settings › Developer (`correctionsFileUri` feeds the share sheet), and
 * "Clear corrections file" deletes it. Every write is gated on
 * METRICS_ENABLED like the rest of the diagnostics, so production builds
 * never create the file, and every function swallows I/O errors — a
 * diagnostics file must never break a save.
 *
 * Not a parse-metrics row: this file holds the user's own words and names
 * (by design — it is the eval case), which parse_metrics never does.
 */
import { File, Paths } from 'expo-file-system';
import { METRICS_ENABLED } from '../../lib/flags';
import {
  buildCorrectionCase,
  CorrectionInput,
  parseCorrectionsText,
  serializeCorrectionLine,
} from '../../domain/parseCorrection';

export const CORRECTIONS_FILE_NAME = 'parse-corrections.jsonl';

function correctionsFile(): File {
  return new File(Paths.document, CORRECTIONS_FILE_NAME);
}

/** A few random hex chars for the case id — `Math.random` is fine here: the
 *  id only has to be unique within one user's file (the date is in it too),
 *  and the fold script de-duplicates by id anyway. */
function nonce(): string {
  return Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
}

/**
 * Build, validate and append one correction. Returns true when a line was
 * written. Validation (zod, in the domain builder) runs BEFORE any I/O, so a
 * malformed case is rejected without touching the file.
 */
export async function recordCorrection(input: Omit<CorrectionInput, 'nonce'>): Promise<boolean> {
  if (!METRICS_ENABLED) return false;
  let line: string;
  try {
    line = serializeCorrectionLine(buildCorrectionCase({ ...input, nonce: nonce() }));
  } catch {
    return false;
  }
  try {
    const file = correctionsFile();
    const existing = file.exists ? await file.text() : '';
    if (!file.exists) file.create();
    // Keep the file newline-terminated so every append starts a fresh line
    // even if an earlier write was cut short.
    const prefix = existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`;
    file.write(`${prefix}${line}\n`);
    return true;
  } catch {
    return false;
  }
}

/** How many valid cases the file holds (0 when absent/unreadable), for the
 *  Settings rows' subtitle. */
export async function countCorrections(): Promise<number> {
  try {
    const file = correctionsFile();
    if (!file.exists) return 0;
    return parseCorrectionsText(await file.text()).cases.length;
  } catch {
    return 0;
  }
}

/** The `file://` URI for the share sheet, or null when there is nothing to
 *  share. The caller shows the privacy copy before sharing. */
export function correctionsFileUri(): string | null {
  try {
    const file = correctionsFile();
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/** Delete the file. Safe when it does not exist. */
export async function clearCorrections(): Promise<void> {
  try {
    const file = correctionsFile();
    if (file.exists) file.delete();
  } catch {
    // ignore — the file is diagnostics, never user data the app depends on
  }
}
