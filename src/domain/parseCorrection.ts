/**
 * "This parse was wrong" — the pure half of the on-device correction loop
 * (parse-quality plan, package C2; see docs/design/parse-correction-loop-
 * spec.md). Framework-free and side-effect-free; the file I/O lives in
 * src/features/diagnostics/corrections.ts.
 *
 * A correction is ONE eval case in the exact shape of `evals/dataset.jsonl`
 * (`evals/dataset-schema.mjs`), minus `split`: the user's own words as
 * `text`, the grounding the engine saw as `context`, and the fields the user
 * corrected to as `expected`. Folded into the dev split on a Mac with
 * `node evals/corrections/fold.mjs` (evals/README.md, "On-device
 * corrections"), it becomes a real-world regression case the on-device probe
 * is scored against — the feedback loop the review found missing.
 *
 * Privacy (CLAUDE.md guardrail #5): a correction contains the user's own
 * text, payee names and account names. It is written ONLY to a file in the
 * app's own documents directory and leaves the device ONLY through an
 * explicit "Share corrections file" tap in Settings › Developer, whose copy
 * says exactly that. Nothing here uploads anything.
 *
 * The schema below MIRRORS `evals/dataset-schema.mjs` (which must not be
 * bundled into the app — the eval harness never ships) and is held to it by
 * tests/__features__/parse-correction.feature, which runs a built case
 * through the real `evals/corrections/fold.mjs --validate`.
 */
import { z } from 'zod';
import { Account, Category, TransactionType } from './types';

/** The one constant shared with the harness's split rules (`evals/split.mjs`'s
 *  `DEV_ADDITION_ID_PREFIX`): an id starting with `dv-` is forced into the
 *  dev split, never hashed into a holdout. The harness never ships, so the
 *  value is duplicated here rather than imported; parse-correction.feature
 *  pins the two to the same string. */
export const DEV_ADDITION_ID_PREFIX = 'dv-';

/** `expected` — `evals/dataset-schema.mjs`'s `expectedSchema`, verbatim. */
export const correctionExpectedSchema = z.object({
  amountMinor: z.number().int().positive(),
  sign: z.enum(['expense', 'income', 'transfer']),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().nullable(),
  payee: z.string().nullable(),
});

/** One correction line. `split` is deliberately absent — `evals/split.mjs`
 *  assigns it on the Mac (the `dv-` id prefix forces `dev`). `engine` is an
 *  extra, optional field the dataset schema passes through, so a folded case
 *  still says which engine got it wrong. */
export const correctionCaseSchema = z.object({
  id: z.string().min(1).regex(/^dv-uc-/),
  axis: z.literal('user-correction'),
  text: z.string().min(1),
  context: z.object({
    categories: z.array(z.object({ name: z.string().min(1), kind: z.enum(['expense', 'income', 'transfer']) })),
    payees: z.array(z.string().min(1)),
    accounts: z.array(z.string().min(1)),
    nowISO: z.string().min(1),
  }),
  expected: correctionExpectedSchema,
  engine: z.string().min(1).optional(),
});

export type CorrectionCase = z.infer<typeof correctionCaseSchema>;

/** What the user confirmed the transaction actually was. */
export interface CorrectedFields {
  amountMinor: number;
  type: TransactionType;
  occurredAt: number;
  categoryName: string | null;
  payeeName: string | null;
}

export interface CorrectionInput {
  /** The user's own words the engine parsed (`Transaction.sourceText` / the
   *  draft's `sourceText`). A correction without them is useless to the
   *  eval, so the callers hide the action when it is missing. */
  text: string;
  categories: Category[];
  /** Names only — the dataset's `context.payees` is a flat name list. */
  payeeNames: string[];
  accounts: Account[];
  /** The clock the parse ran against (relative dates resolve from it). For a
   *  post-save edit, the row's `createdAt` is the closest thing we have. */
  now: number;
  corrected: CorrectedFields;
  engine?: string | null;
  /** Entropy for the id — injected so the builder stays pure. Any string;
   *  callers pass a few random hex chars. */
  nonce: string;
}

/** `dv-uc-20261010-3f9a1c` — `dv-` so `evals/split.mjs` forces it into the
 *  dev split (it is written to be tuned against), `uc` = user correction. */
export function correctionId(now: number, nonce: string): string {
  const d = new Date(now);
  const ymd =
    `${d.getFullYear()}` +
    `${String(d.getMonth() + 1).padStart(2, '0')}` +
    `${String(d.getDate()).padStart(2, '0')}`;
  const clean = nonce.replace(/[^a-z0-9]/gi, '').toLowerCase() || '0';
  return `${DEV_ADDITION_ID_PREFIX}uc-${ymd}-${clean}`;
}

/** Local calendar day as `YYYY-MM-DD` — the dataset's `dateISO` convention
 *  (every committed case's date is a local day, not a UTC instant). */
export function localDateISO(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local time with the device's own UTC offset, e.g.
 *  `2026-07-16T12:00:00+08:00` — the dataset's `nowISO` convention. */
export function localNowISO(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/**
 * Build one correction case. Throws (zod) when the result would not be a
 * valid dataset case — e.g. an empty text or a non-positive amount — so a
 * malformed line can never reach the file. A transfer's category/payee are
 * always null (the dataset models a transfer by `sign` only).
 */
export function buildCorrectionCase(input: CorrectionInput): CorrectionCase {
  const isTransfer = input.corrected.type === 'transfer';
  const draft = {
    id: correctionId(input.now, input.nonce),
    axis: 'user-correction' as const,
    text: input.text,
    context: {
      categories: input.categories.map((c) => ({ name: c.name, kind: c.kind })),
      payees: input.payeeNames,
      accounts: input.accounts.filter((a) => !a.archived).map((a) => a.name),
      nowISO: localNowISO(input.now),
    },
    expected: {
      amountMinor: input.corrected.amountMinor,
      sign: input.corrected.type,
      dateISO: localDateISO(input.corrected.occurredAt),
      category: isTransfer ? null : input.corrected.categoryName || null,
      payee: isTransfer ? null : input.corrected.payeeName || null,
    },
    ...(input.engine ? { engine: input.engine } : {}),
  };
  return correctionCaseSchema.parse(draft);
}

/** One JSONL line (no trailing newline) — validated again on the way out,
 *  so the file-writing layer cannot append anything the schema rejects. */
export function serializeCorrectionLine(c: CorrectionCase): string {
  return JSON.stringify(correctionCaseSchema.parse(c));
}

/** Parse a corrections file back (for the count shown in Settings and for
 *  tests). Invalid lines are reported, not thrown — a half-written last line
 *  must not make the whole file unreadable. */
export function parseCorrectionsText(text: string): { cases: CorrectionCase[]; invalid: number } {
  const cases: CorrectionCase[] = [];
  let invalid = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      cases.push(correctionCaseSchema.parse(JSON.parse(line)));
    } catch {
      invalid++;
    }
  }
  return { cases, invalid };
}
