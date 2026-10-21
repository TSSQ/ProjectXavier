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
import { CorrectionEdits, correctionEditsSchema } from './correctionEdits';
import { QUERY_TOOL_NAMES } from './queryToolNames';
import { PERIOD_TOKENS } from './periodRange';

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
  /** The label — null ONLY for a discarded draft (`edits.discarded`), which
   *  has no ground truth; `fold.mjs` keeps those out of the dataset. */
  expected: correctionExpectedSchema.nullable(),
  engine: z.string().min(1).optional(),
  /** What changed, per field, and how the draft came to be — see
   *  domain/correctionEdits.ts. Optional so cases written before it existed
   *  still read back; `fold.mjs` drops it before writing the dataset. */
  edits: correctionEditsSchema.optional(),
}).refine((c) => (c.expected === null) === (c.edits?.discarded === true), {
  message: 'expected is null exactly when the draft was discarded',
  path: ['expected'],
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
  /** What the user saved. null for a discarded draft — then `edits` must
   *  say so (`edits.discarded`), and the case carries `expected: null`. */
  corrected: CorrectedFields | null;
  engine?: string | null;
  /** Per-field before/after (domain/correctionEdits.ts). */
  edits?: CorrectionEdits;
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
  const c = input.corrected;
  const isTransfer = c?.type === 'transfer';
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
    expected: c
      ? {
          amountMinor: c.amountMinor,
          sign: c.type,
          dateISO: localDateISO(c.occurredAt),
          category: isTransfer ? null : c.categoryName || null,
          payee: isTransfer ? null : c.payeeName || null,
        }
      : null,
    ...(input.engine ? { engine: input.engine } : {}),
    ...(input.edits ? { edits: input.edits } : {}),
  };
  return correctionCaseSchema.parse(draft);
}

/** One JSONL line (no trailing newline) — validated again on the way out,
 *  so the file-writing layer cannot append anything the schema rejects. */
export function serializeCorrectionLine(c: CorrectionCase): string {
  return JSON.stringify(correctionCaseSchema.parse(c));
}

// ─── "Wrong answer" on an Ask-Xavier card ──────────────────────────────────
//
// The `question` kind of correction: the user's question, the engine that
// answered (`servedBy`), the tool call that ran and how its filters resolved,
// the call the user corrected it to, the context's names, and the answer's
// figure before and after. Same file, same id prefix, same axis and same
// gates as a transaction correction; told apart by its `question` block.
//
// No question dataset shape existed in evals/ when this was written, so this
// defines a minimal one (mirrored in `evals/dataset-schema.mjs`'s optional
// `question` block). `expect` uses the query corpus's own names
// (tests/query-corpus.jsonl: expectTool / expectPeriod / expectCategory) so a
// case maps onto it directly; `expected` is null — a question has no
// transaction label.

/** A JSON-safe tool call: the tool and its (already validated) params. */
const questionCallSchema = z.object({
  tool: z.enum(QUERY_TOOL_NAMES),
  params: z
    .record(z.string(), z.unknown())
    .refine((p) => JSON.stringify(p).length <= 2000, { message: 'params too large' }),
});

const answerFigureSchema = z.object({
  amountMinor: z.number().int().nullable(),
  items: z.number().int().nonnegative().nullable(),
});

export const questionBlockSchema = z.object({
  /** The engine that answered: 'on_device' | 'openai' | 'anthropic' | 'floor'. */
  engine: z.string().min(1),
  call: questionCallSchema,
  /** How each named filter resolved (src/domain/queryFilterResolution.ts). */
  filters: z
    .array(
      z.object({
        dim: z.enum(['category', 'payee', 'account']),
        term: z.string().max(300),
        how: z.enum(['exact', 'memory', 'fuzzy', 'synonym', 'union', 'none']),
        names: z.array(z.string()).max(50),
      })
    )
    .max(3),
  corrected: questionCallSchema,
  /** What the user said was wrong. Empty = marked wrong, nothing changed. */
  dimensions: z.array(z.enum(['tool', 'period', 'filter'])).max(3),
  /** The corrected call in the query corpus's terms. `expectPeriod` 'other'
   *  = none of the listed periods (the call kept the one that ran). */
  expect: z.object({
    expectTool: z.enum(QUERY_TOOL_NAMES),
    expectPeriod: z.enum([...PERIOD_TOKENS, 'other']).nullable(),
    expectCategory: z.string().nullable(),
    expectPayee: z.string().nullable(),
  }),
  answer: z.object({ before: answerFigureSchema, after: answerFigureSchema }),
});

export const questionCorrectionCaseSchema = z.object({
  id: z.string().min(1).regex(/^dv-uq-/),
  axis: z.literal('user-correction'),
  text: z.string().min(1),
  context: correctionCaseSchema.innerType().shape.context,
  expected: z.null(),
  engine: z.string().min(1),
  question: questionBlockSchema,
});

export type QuestionCorrectionCase = z.infer<typeof questionCorrectionCaseSchema>;
export type QuestionBlock = z.infer<typeof questionBlockSchema>;

export interface QuestionCorrectionInput {
  text: string;
  categories: Category[];
  payeeNames: string[];
  accounts: Account[];
  now: number;
  question: QuestionBlock;
  nonce: string;
}

/** `dv-uq-20261021-3f9a1c` — `uq` = user question. */
export function questionCorrectionId(now: number, nonce: string): string {
  return correctionId(now, nonce).replace(`${DEV_ADDITION_ID_PREFIX}uc-`, `${DEV_ADDITION_ID_PREFIX}uq-`);
}

/** Build one question correction. Throws (zod) when it would not validate,
 *  so a malformed line never reaches the file. */
export function buildQuestionCorrectionCase(input: QuestionCorrectionInput): QuestionCorrectionCase {
  return questionCorrectionCaseSchema.parse({
    id: questionCorrectionId(input.now, input.nonce),
    axis: 'user-correction',
    text: input.text,
    context: {
      categories: input.categories.map((c) => ({ name: c.name, kind: c.kind })),
      payees: input.payeeNames,
      accounts: input.accounts.filter((a) => !a.archived).map((a) => a.name),
      nowISO: localNowISO(input.now),
    },
    expected: null,
    engine: input.question.engine,
    question: input.question,
  });
}

/** One JSONL line for a question correction, validated on the way out. */
export function serializeQuestionCorrectionLine(c: QuestionCorrectionCase): string {
  return JSON.stringify(questionCorrectionCaseSchema.parse(c));
}

/** Parse a corrections file back (for the count shown in Settings and for
 *  tests). Invalid lines are reported, not thrown — a half-written last line
 *  must not make the whole file unreadable. Question corrections are
 *  returned on their own (`questions`), never mixed into `cases`. */
export function parseCorrectionsText(text: string): {
  cases: CorrectionCase[];
  questions: QuestionCorrectionCase[];
  invalid: number;
} {
  const cases: CorrectionCase[] = [];
  const questions: QuestionCorrectionCase[] = [];
  let invalid = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const json: unknown = JSON.parse(line);
      if (json && typeof json === 'object' && 'question' in json) questions.push(questionCorrectionCaseSchema.parse(json));
      else cases.push(correctionCaseSchema.parse(json));
    } catch {
      invalid++;
    }
  }
  return { cases, questions, invalid };
}
