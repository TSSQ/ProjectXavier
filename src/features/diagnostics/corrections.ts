/**
 * The on-device corrections file — the I/O half of "This parse was wrong"
 * (docs/design/parse-correction-loop-spec.md; pure builder/validator in
 * src/domain/parseCorrection.ts).
 *
 * One JSONL file in the app's own documents directory
 * (`Paths.document/parse-corrections.jsonl`), one eval-dataset-shaped case per
 * line, appended to on each report (a true end-of-file append, one write at
 * a time — see `appendLine` and `writes`). Everything stays on the device:
 * the only way a line leaves is the user tapping "Share corrections file" in
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
import { createSerialQueue } from '../../domain/serialQueue';
import {
  buildCorrectionEdits,
  CorrectionEdits,
  shouldCapture,
  snapshotOf,
  SnapshotSource,
} from '../../domain/correctionEdits';
import { Account, Category } from '../../domain/types';
import { engineForTxId } from './parseMetrics';
import {
  buildCorrectionCase,
  CorrectionCase,
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

/** Every write to the file (append, clear) takes its turn here, so two
 *  reports saved at once never interleave or lose a line. */
const writes = createSerialQueue();

const NEWLINE = 0x0a;

/**
 * Append `line` at the end of the file through a FileHandle — the bytes
 * already there are never read back or rewritten, so a crash mid-write can
 * at worst leave a partial LAST line (which `parseCorrectionsText` skips as
 * invalid), never a truncated file. If an earlier write was cut short
 * without its newline, this line starts on a fresh one.
 */
function appendLine(file: File, line: string): void {
  if (!file.exists) file.create();
  const handle = file.open();
  try {
    const size = handle.size ?? 0;
    let text = `${line}\n`;
    if (size > 0) {
      handle.offset = size - 1;
      if (handle.readBytes(1)[0] !== NEWLINE) text = `\n${text}`;
    }
    handle.offset = size;
    handle.writeBytes(new TextEncoder().encode(text));
  } finally {
    handle.close();
  }
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
    await writes.run(async () => appendLine(correctionsFile(), line));
    return true;
  } catch {
    return false;
  }
}

/**
 * Automatic capture (docs/design/parse-correction-loop-spec.md §6): write the
 * case only when `shouldCapture` says so — a field changed, the draft was
 * discarded, or the user tapped "This parse was wrong" (`reported`). Same
 * gate, validation and append as `recordCorrection`; never throws.
 */
export async function captureCorrection(
  input: Omit<CorrectionInput, 'nonce' | 'edits'> & { edits: CorrectionEdits; reported: boolean }
): Promise<boolean> {
  if (!METRICS_ENABLED) return false;
  const { reported, ...rest } = input;
  if (!shouldCapture(rest.edits, reported)) return false;
  return recordCorrection(rest);
}

/**
 * A later edit of a SAVED AI row (Transactions tab, account screen):
 * `before` is the row as it was saved, `after` what the user saved now. The
 * engine is read from the row's linked parse_metrics row; the parse source,
 * applied defaults and refusal are not known this late (null / [] / false).
 * Shared by both edit screens so they cannot drift apart.
 */
export async function capturePostSaveCorrection(input: {
  txId: string;
  text: string;
  before: SnapshotSource;
  after: SnapshotSource;
  categories: Category[];
  payeeNames: string[];
  accounts: Account[];
  /** The row's createdAt — the closest thing to the parse's own clock. */
  now: number;
  reported: boolean;
}): Promise<boolean> {
  if (!METRICS_ENABLED) return false;
  try {
    const engine = await engineForTxId(input.txId);
    const edits = buildCorrectionEdits({
      from: snapshotOf(input.before, input.accounts),
      to: snapshotOf(input.after, input.accounts),
      stage: 'post_save',
      engine,
      parseSource: null,
      appliedDefaults: [],
      refused: false,
    });
    return await captureCorrection({
      text: input.text,
      categories: input.categories,
      payeeNames: input.payeeNames,
      accounts: input.accounts,
      now: input.now,
      corrected: {
        amountMinor: input.after.amount,
        type: input.after.type,
        occurredAt: input.after.occurredAt,
        categoryName: input.after.categoryName,
        payeeName: input.after.payeeName,
      },
      engine,
      edits,
      reported: input.reported,
    });
  } catch {
    return false;
  }
}

/** Every valid case in the file (empty when absent/unreadable) — the
 *  developer screen's per-engine edit view reads this. */
export async function readCorrectionCases(): Promise<CorrectionCase[]> {
  if (!METRICS_ENABLED) return [];
  try {
    const file = correctionsFile();
    if (!file.exists) return [];
    return parseCorrectionsText(await file.text()).cases;
  } catch {
    return [];
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
    await writes.run(async () => {
      const file = correctionsFile();
      if (file.exists) file.delete();
    });
  } catch {
    // ignore — the file is diagnostics, never user data the app depends on
  }
}
