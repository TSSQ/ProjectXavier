/**
 * What the user changed — the before/after half of the on-device correction
 * loop (docs/design/parse-correction-loop-spec.md §6). Framework-free and
 * side-effect-free; BDD-tested in tests/__features__/correction-edits.feature.
 *
 * `parseCorrection.ts` turns a correction into an eval case (`expected` = what
 * the user saved). This module adds WHAT changed: for each of seven fields,
 * `{ from, to }` — `from` what the engine proposed (or, for a post-save edit,
 * the row as it was saved), `to` what the user saved — plus which fields the
 * user's history pre-filled (`appliedDefaults`), whether the user overrode a
 * refusal (`refused`), and whether they threw the draft away (`discarded`).
 * Names, never ids; null when there was nothing.
 *
 * `shouldCapture` is the automatic-capture rule; `aggregateCorrectionEdits`
 * is the developer screen's per-engine view of the file.
 *
 * Privacy (CLAUDE.md guardrail #5): these are the user's own values. They are
 * written only to the on-device corrections file (diagnostics builds only),
 * leave the device only through the explicit "Share corrections file" tap,
 * and are dropped by `evals/corrections/fold.mjs` before anything reaches the
 * committed dataset.
 */
import { z } from 'zod';
import { TransactionDraft } from './assistant';
import { revertLearnedAccount, revertLearnedCategory } from './learnedDefaults';
import { revertLearnedPayee, revertLearnedType } from './phraseMemory';
import { normalizeName } from './textMatch';
import { Account, TransactionType } from './types';

export const CORRECTION_FIELDS = [
  'amount',
  'type',
  'category',
  'payee',
  'account',
  'date',
  'note',
] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

/** One field's value as a correction records it: minor units for amount,
 *  `YYYY-MM-DD` for date, a name/value string for the rest. */
export type FieldValue = string | number | null;

/** The seven fields of a draft or a saved row, in recordable form. */
export type FieldSnapshot = Record<CorrectionField, FieldValue>;

const fieldValueSchema = z.union([z.string(), z.number()]).nullable();
const fieldEditSchema = z.object({ from: fieldValueSchema, to: fieldValueSchema });

/**
 * The `edits` block on a correction case. Mirrored (looser) by
 * `evals/dataset-schema.mjs`'s `editsSchema`, so `fold.mjs --validate`
 * accepts a case that carries it.
 *  - `stage`: 'draft' when captured at the card/editor (`from` is the
 *    engine's own proposal, before any learned default), 'post_save' when a
 *    saved AI row was edited later (`from` is the row as it was saved).
 *  - `parseSource`: the draft card's source ('on_device', 'openai',
 *    'anthropic', 'heuristic', 'heuristic_fallback', 'layout'); null for a
 *    post-save edit, where only `engine` is known.
 *  - `appliedDefaults`: the fields history pre-filled, `<source>:<field>`
 *    (`payee:category`, `phrase:type`, … — see `appliedDefaultsOf`).
 */
export const correctionEditsSchema = z.object({
  amount: fieldEditSchema,
  type: fieldEditSchema,
  category: fieldEditSchema,
  payee: fieldEditSchema,
  account: fieldEditSchema,
  date: fieldEditSchema,
  note: fieldEditSchema,
  stage: z.enum(['draft', 'post_save']),
  engine: z.string().min(1).nullable(),
  parseSource: z.string().min(1).nullable(),
  appliedDefaults: z.array(z.string().min(1)).max(8),
  refused: z.boolean(),
  discarded: z.boolean(),
});
export type CorrectionEdits = z.infer<typeof correctionEditsSchema>;

/** Local calendar day — the same convention as the case's `dateISO`. */
function dayISO(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const nameOrNull = (s: string | null | undefined): string | null => {
  const t = s?.trim();
  return t ? t : null;
};

/** The recordable fields of anything shaped like a draft or a saved row. */
export interface SnapshotSource {
  amount: number;
  type: TransactionType;
  categoryName: string | null;
  payeeName: string | null;
  accountId: string;
  occurredAt: number;
  note: string | null;
}

export function snapshotOf(src: SnapshotSource, accounts: Pick<Account, 'id' | 'name'>[]): FieldSnapshot {
  return {
    amount: src.amount > 0 ? src.amount : null,
    type: src.type,
    category: nameOrNull(src.categoryName),
    payee: nameOrNull(src.payeeName),
    account: accounts.find((a) => a.id === src.accountId)?.name ?? null,
    date: dayISO(src.occurredAt),
    note: nameOrNull(src.note),
  };
}

/** The engine's OWN proposal for a draft as the card first showed it: every
 *  field the user's history set — phrase memory's type/payee/category/account
 *  (domain/phraseMemory.ts) and the payee's learned category/account
 *  (domain/learnedDefaults.ts) — put back to what the engine said, so `from`
 *  never credits the engine with the user's history. The type goes first: its
 *  revert also restores the category phrase memory set with it. */
export function engineProposalOf(draft: TransactionDraft): TransactionDraft {
  return revertLearnedAccount(revertLearnedCategory(revertLearnedPayee(revertLearnedType(draft))));
}

/** Which fields the user's history pre-filled on this draft, named by where
 *  they came from: `payee:category` / `payee:account` (the payee's learned
 *  defaults), `phrase:type` / `phrase:category` / `phrase:payee` /
 *  `phrase:account` (phrase memory). */
export function appliedDefaultsOf(draft: TransactionDraft): string[] {
  const out: string[] = [];
  const tag = (field: string, source: string | undefined) => `${source ?? 'payee'}:${field}`;
  if (draft.learnedType) out.push(tag('type', draft.learnedType.source));
  if (draft.learnedCategory) out.push(tag('category', draft.learnedCategory.source));
  if (draft.learnedPayee) out.push(tag('payee', draft.learnedPayee.source));
  if (draft.learnedAccount) out.push(tag('account', draft.learnedAccount.source));
  return out;
}

/** Same value? Names compare normalised (case/spacing), so "starbucks" →
 *  "Starbucks" is not an edit; numbers and days compare exactly. */
function same(a: FieldValue, b: FieldValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === 'string' && typeof b === 'string') return normalizeName(a) === normalizeName(b);
  return a === b;
}

export interface EditsInput {
  from: FieldSnapshot;
  /** null for a discarded draft — every `to` is then null. */
  to: FieldSnapshot | null;
  stage: CorrectionEdits['stage'];
  engine: string | null;
  parseSource: string | null;
  appliedDefaults: string[];
  refused: boolean;
}

export function buildCorrectionEdits(input: EditsInput): CorrectionEdits {
  const edits = {} as Record<CorrectionField, { from: FieldValue; to: FieldValue }>;
  for (const f of CORRECTION_FIELDS) {
    edits[f] = { from: input.from[f], to: input.to ? input.to[f] : null };
  }
  return correctionEditsSchema.parse({
    ...edits,
    stage: input.stage,
    engine: input.engine || null,
    parseSource: input.parseSource || null,
    appliedDefaults: input.appliedDefaults,
    refused: input.refused,
    discarded: input.to === null,
  });
}

/** The fields whose value changed (always empty for a discard). */
export function changedFields(edits: CorrectionEdits): CorrectionField[] {
  if (edits.discarded) return [];
  return CORRECTION_FIELDS.filter((f) => !same(edits[f].from, edits[f].to));
}

/**
 * Automatic capture: write a case when the user changed at least one field,
 * when they discarded the draft, or when they explicitly reported the parse
 * as wrong (the manual button — for "it looked right but wasn't").
 */
export function shouldCapture(edits: CorrectionEdits, reported: boolean): boolean {
  return reported || edits.discarded || changedFields(edits).length > 0;
}

// ── The developer screen's view ─────────────────────────────────────────────

/** How an amount changed: a wrong digit vs a wrong order of magnitude. */
export function amountChangeKind(from: FieldValue, to: FieldValue): string {
  if (typeof from !== 'number' || typeof to !== 'number' || from <= 0 || to <= 0) return 'other';
  const big = Math.max(from, to);
  const small = Math.min(from, to);
  const ratio = big / small;
  const exp = Math.round(Math.log10(ratio));
  if (exp > 0 && big === small * 10 ** exp) return 'scale changed';
  if (String(from).length === String(to).length) return 'digits changed';
  return 'other';
}

const DAY_MS = 86_400_000;

/** The day offset `to − from` in buckets: "+1 day", "-1 day", "±2–7 days",
 *  "> 7 days earlier/later". */
export function dateOffsetBucket(from: FieldValue, to: FieldValue): string {
  if (typeof from !== 'string' || typeof to !== 'string') return 'other';
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  const days = Math.round((parse(to) - parse(from)) / DAY_MS);
  if (days === 1) return '+1 day';
  if (days === -1) return '-1 day';
  if (days >= 2 && days <= 7) return '+2–7 days';
  if (days <= -2 && days >= -7) return '-2–7 days';
  if (days > 7) return '> 7 days later';
  if (days < -7) return '> 7 days earlier';
  return 'same day';
}

/** One field's from→to pair as the developer screen groups it. */
export function pairLabel(field: CorrectionField, from: FieldValue, to: FieldValue): string {
  if (field === 'amount') return amountChangeKind(from, to);
  if (field === 'date') return dateOffsetBucket(from, to);
  if (field === 'note') return from === null ? 'added' : to === null ? 'removed' : 'changed';
  return `${from ?? '—'} → ${to ?? '—'}`;
}

export interface FieldEditStats {
  /** Cases in which this field changed. */
  edits: number;
  /** The most common pairs, most frequent first (ties by label), at most 5. */
  top: Array<{ pair: string; count: number }>;
}

export interface EngineEditStats {
  /** Captured cases for this engine that were saved (not discarded). */
  cases: number;
  discarded: number;
  /** Cases whose draft carried a refusal the user overrode. */
  refused: number;
  fields: Record<CorrectionField, FieldEditStats>;
}

export const TOP_PAIRS = 5;

function perField<T>(make: () => T): Record<CorrectionField, T> {
  const out = {} as Record<CorrectionField, T>;
  for (const f of CORRECTION_FIELDS) out[f] = make();
  return out;
}

/** Per engine (`edits.engine`, '(unknown)' when absent), per field: how often
 *  it changed and the top from→to pairs. Cases without `edits` (written
 *  before it existed) are ignored. */
export function aggregateCorrectionEdits(
  cases: ReadonlyArray<{ edits?: CorrectionEdits | null }>
): Record<string, EngineEditStats> {
  const counts: Record<string, { stats: EngineEditStats; pairs: Record<CorrectionField, Map<string, number>> }> = {};
  for (const c of cases) {
    const e = c.edits;
    if (!e) continue;
    const key = e.engine ?? '(unknown)';
    const slot = (counts[key] ??= {
      stats: { cases: 0, discarded: 0, refused: 0, fields: perField(() => ({ edits: 0, top: [] })) },
      pairs: perField(() => new Map<string, number>()),
    });
    if (e.refused) slot.stats.refused++;
    if (e.discarded) {
      slot.stats.discarded++;
      continue;
    }
    slot.stats.cases++;
    for (const f of changedFields(e)) {
      slot.stats.fields[f].edits++;
      const label = pairLabel(f, e[f].from, e[f].to);
      slot.pairs[f].set(label, (slot.pairs[f].get(label) ?? 0) + 1);
    }
  }
  const out: Record<string, EngineEditStats> = {};
  for (const [engine, { stats, pairs }] of Object.entries(counts)) {
    for (const f of CORRECTION_FIELDS) {
      stats.fields[f].top = [...pairs[f].entries()]
        .map(([pair, count]) => ({ pair, count }))
        .sort((a, b) => b.count - a.count || a.pair.localeCompare(b.pair))
        .slice(0, TOP_PAIRS);
    }
    out[engine] = stats;
  }
  return out;
}
