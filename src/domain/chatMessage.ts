/**
 * The chat log's row model and its zod payload schemas (docs/design/
 * xavier-daily-chat-spec.md §5). Pure and framework-free.
 *
 * `chat_messages.payload` is JSON in a database column, so it is a trust
 * boundary: every payload is validated here on write AND on read (guardrail
 * 6). A row that fails is skipped by the repository, never thrown.
 *
 * Reload rules (the recorder and the screen honour these when they load a
 * stored day):
 *  - The screen's card state is not persisted, so NOTHING reloads as
 *    interactive: a stored `query_answer` becomes resolved (read-only history),
 *    and every other live card becomes abandoned, or stale when its
 *    `dataRevision` differs from the current one (src/domain/chatLog.ts
 *    `applyReloadRule`). That also covers an app killed mid-parse: there is no
 *    "thinking" row to restore, the last user message simply has no reply.
 *  - A card shown in the session is live only while the screen holds it;
 *    `dataRevision` is what the stale check (`dropStaleReply`, the tx-op
 *    picker's own) compares against, for the four kinds the screen drops.
 *  - Drafts and accounts are stored by NAME; payloads never carry ids a rename
 *    or delete could orphan (the few ids kept, such as `accountId`, are
 *    re-checked before use).
 *  - A message's `dayKey` is the SESSION's day key, fixed when the day loads
 *    (or resets), not the wall clock at write time, so a conversation that runs
 *    past midnight stays one day for "Today · N logged". The daily reset
 *    (src/domain/chatDay.ts) clears everything on the next open after.
 *
 * Payloads hold DISPLAY data only: strings, integers (minor units), epochs and
 * enums, enough to render a card read-only and to word its stub. They never
 * hold model prose (a query answer keeps its deterministic tool result and its
 * deterministic caption) and never an image (`user_photo` is a label).
 */
import { z } from 'zod';
import { QUERY_TOOL_NAMES, MAX_SERIES_BUCKETS } from './queryToolNames';
import { ACCOUNT_UPDATE_OPERATIONS } from './accountUpdateOperations';
import { TRANSACTION_NOTE_MAX_CHARS } from '../lib/validation';

export const CHAT_ROLES = ['user', 'xavier'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const CHAT_STATUSES = ['live', 'resolved', 'abandoned', 'stale'] as const;
export type ChatStatus = (typeof CHAT_STATUSES)[number];

export const CHAT_CARD_KINDS = [
  'draft',
  'account_create',
  'account_update',
  'afford',
  'afford_pick',
  'set_budget',
  'delete_handoff',
  'tx_picker',
  'query_answer',
  'statement_queue',
] as const;
export type ChatCardKind = (typeof CHAT_CARD_KINDS)[number];

export const CHAT_KINDS = [
  'user_text',
  'user_photo',
  'xavier_text',
  'xavier_receipt',
  ...CHAT_CARD_KINDS,
] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export const isChatCardKind = (kind: ChatKind): kind is ChatCardKind =>
  (CHAT_CARD_KINDS as readonly string[]).includes(kind);

// ─── field building blocks ──────────────────────────────────────────────────

const text = (max: number) => z.string().max(max);
const name = text(120);
const body = text(2000);
const minor = z.number().int().safe();
const epoch = z.number().int().nonnegative();
const currency = z.string().min(1).max(8);
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const notes = z.array(text(300)).max(10);
const txNote = text(TRANSACTION_NOTE_MAX_CHARS);
/** A real calendar date, not just the right shape: rejects 2026-02-30. */
const dayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((k) => {
    const [y, m, d] = k.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'not a calendar date');

// ─── text kinds ─────────────────────────────────────────────────────────────

const userTextPayload = z.object({ text: body });
/** A label only, e.g. "📷 Receipt". The image itself is never stored. */
const userPhotoPayload = z.object({ label: text(80) });
/** `logged`: this line confirms a transaction saved from the chat (counted by the header). */
const xavierTextPayload = z.object({ text: body, logged: z.boolean().optional() });

/** Mirrors the speech bubble's receipt content (src/domain/bubbleCopy.ts). */
const xavierReceiptPayload = z.object({
  headline: text(300),
  amountText: text(60).optional(),
  amountTone: z.enum(['negative', 'positive']).optional(),
  lines: z.array(text(300)).max(8),
  /** True when this receipt confirms a transaction saved from the chat; the
   *  header's "Today · N logged" counts these (src/domain/chatLog.ts), along
   *  with `xavier_text` lines carrying the same flag. */
  logged: z.boolean().optional(),
  budget: z
    .object({
      usedRatio: z.number().min(0).max(1),
      state: z.enum(['ok', 'warn', 'over']),
      amountText: text(60),
      verb: z.enum(['left', 'over']),
      where: text(160),
    })
    .optional(),
});

// ─── card kinds ─────────────────────────────────────────────────────────────

/** An unconfirmed transaction, by account NAME so a later rename or delete
 *  cannot break a read-only render. */
const draftPayload = z.object({
  type: z.enum(['expense', 'income', 'transfer']),
  amount: minor.positive(),
  currency,
  accountName: name,
  toAccountName: name.nullable(),
  categoryName: name.nullable(),
  payeeName: name.nullable(),
  note: txNote.nullable(),
  occurredAt: epoch,
  unmatchedAccountName: name.optional(),
  ambiguousAccountNames: z.array(name).max(10).optional(),
});

const accountCreatePayload = z.object({
  name,
  subtype: text(40).nullable(),
  openingBalance: minor,
  currency,
});

const accountUpdatePayload = z.object({
  accountId: z.string().min(1).max(64),
  currentName: name,
  op: z.enum(ACCOUNT_UPDATE_OPERATIONS),
  newName: name,
  newSubtype: text(40).nullable(),
  newBalance: minor,
  balanceEdited: z.boolean(),
  currency,
});

const affordPayload = z.object({
  text: body,
  /** A category id, or 'all'. */
  scope: z.string().min(1).max(64),
  categoryName: name.nullable(),
  icon: text(16).nullable(),
  amount: minor.positive(),
  month: monthKey,
  currency,
  verdict: z.enum(['fits', 'over']),
  leftNow: minor,
  after: minor,
  overall: text(300).nullable(),
  /** The category's budget gauge; null for "all budgets". */
  view: z
    .object({
      budget: minor,
      spent: minor,
      left: minor,
      state: z.enum(['ok', 'warn', 'over']),
    })
    .nullable(),
});

const affordPickPayload = z.object({
  text: body,
  amount: minor.positive().nullable(),
  currency,
  options: z
    .array(
      z.object({
        categoryId: z.string().min(1).max(64),
        name,
        icon: text(16).nullable(),
      })
    )
    .max(12),
});

const setBudgetPayload = z.object({
  categoryName: name,
  change: z.enum(['set', 'edit', 'remove']),
  text: body,
  current: minor.nullable(),
  /** The amount the confirm would write; null for a removal. */
  next: minor.nullable(),
  currency,
});

const deleteHandoffPayload = z.object({
  accountId: z.string().min(1).max(64),
  accountName: name,
  message: body,
});

const txPickerPayload = z.object({
  op: z.enum(['delete', 'update']),
  currency,
  rows: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        type: z.enum(['expense', 'income', 'transfer']),
        amountMinor: minor,
        occurredAt: epoch,
        payeeName: name.nullable(),
        categoryName: name.nullable(),
        accountName: name.nullable(),
      })
    )
    .max(50),
});

const statementQueuePayload = z.object({
  total: z.number().int().nonnegative().max(500),
  saved: z.number().int().nonnegative().max(500),
  skipped: z.number().int().nonnegative().max(500),
  accountName: name.nullable(),
});

// query_answer: the deterministic tool result, per tool. This MIRRORS the
// `*Result` interfaces in src/domain/queryTools.ts (TotalSpentResult,
// SpendingByCategoryResult, ...): change one, change the other. Caps follow the
// domain's own limits (MAX_SERIES_BUCKETS, the 20-row top-payee and search
// limits, TRANSACTION_NOTE_MAX_CHARS). Charts redraw from this; nothing here is model prose.
const resolvedNames = {
  resolvedCategory: name.optional(),
  resolvedPayee: name.optional(),
  resolvedAccount: name.optional(),
};
const seriesPoint = z.object({ label: text(60), amountMinor: minor });

const queryResult = {
  total_spent: z.object({ amountMinor: minor, count: z.number().int().nonnegative(), notes, ...resolvedNames }),
  total_income: z.object({ amountMinor: minor, count: z.number().int().nonnegative(), notes, ...resolvedNames }),
  spending_by_category: z.object({
    notes,
    slices: z
      .array(z.object({ categoryId: z.string().max(64).nullable(), name, amountMinor: minor }))
      .max(100),
  }),
  spending_over_time: z.object({ notes, series: z.array(seriesPoint).max(MAX_SERIES_BUCKETS), ...resolvedNames }),
  top_payees: z.object({
    notes,
    rows: z
      .array(
        z.object({
          payeeId: z.string().max(64).nullable(),
          name,
          amountMinor: minor,
          count: z.number().int().nonnegative(),
        })
      )
      .max(20),
  }),
  net_worth: z.object({ notes, amountMinor: minor.optional(), series: z.array(seriesPoint).max(MAX_SERIES_BUCKETS).optional() }),
  search_transactions: z.object({
    notes,
    ...resolvedNames,
    rows: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          type: z.enum(['expense', 'income', 'transfer']),
          amountMinor: minor,
          occurredAt: epoch,
          categoryName: name.nullable(),
          payeeName: name.nullable(),
          accountName: name.nullable(),
          note: txNote.nullable(),
        })
      )
      .max(50),
  }),
} satisfies Record<(typeof QUERY_TOOL_NAMES)[number], z.ZodTypeAny>;

const queryAnswerShared = {
  currency,
  /** The deterministic caption (src/domain/queryCaption.ts), never model prose. */
  caption: text(400).nullable(),
  comparison: z
    .object({
      tool: z.enum(['total_spent', 'total_income', 'net_worth']),
      title: text(60),
      series: z.array(seriesPoint).max(24),
    })
    .nullable(),
};

const queryAnswerPayload = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('total_spent'), result: queryResult.total_spent, ...queryAnswerShared }),
  z.object({ tool: z.literal('total_income'), result: queryResult.total_income, ...queryAnswerShared }),
  z.object({ tool: z.literal('spending_by_category'), result: queryResult.spending_by_category, ...queryAnswerShared }),
  z.object({ tool: z.literal('spending_over_time'), result: queryResult.spending_over_time, ...queryAnswerShared }),
  z.object({ tool: z.literal('top_payees'), result: queryResult.top_payees, ...queryAnswerShared }),
  z.object({ tool: z.literal('net_worth'), result: queryResult.net_worth, ...queryAnswerShared }),
  z.object({ tool: z.literal('search_transactions'), result: queryResult.search_transactions, ...queryAnswerShared }),
]);

// ─── the row ────────────────────────────────────────────────────────────────

const base = {
  id: z.string().min(1).max(64),
  dayKey,
  seq: z.number().int().positive(),
  status: z.enum(CHAT_STATUSES),
  /** For cards: the data revision they were built against. */
  dataRevision: z.number().int().nonnegative().nullable(),
  createdAt: epoch,
};

const row = <K extends ChatKind, P extends z.ZodTypeAny>(kind: K, payload: P) =>
  z.object({ ...base, role: z.enum(CHAT_ROLES), kind: z.literal(kind), payload });

export const chatMessageSchema = z
  .discriminatedUnion('kind', [
    row('user_text', userTextPayload),
    row('user_photo', userPhotoPayload),
    row('xavier_text', xavierTextPayload),
    row('xavier_receipt', xavierReceiptPayload),
    row('draft', draftPayload),
    row('account_create', accountCreatePayload),
    row('account_update', accountUpdatePayload),
    row('afford', affordPayload),
    row('afford_pick', affordPickPayload),
    row('set_budget', setBudgetPayload),
    row('delete_handoff', deleteHandoffPayload),
    row('tx_picker', txPickerPayload),
    row('query_answer', queryAnswerPayload),
    row('statement_queue', statementQueuePayload),
  ])
  .refine((m) => (m.kind === 'user_text' || m.kind === 'user_photo') === (m.role === 'user'), {
    message: 'role does not match kind',
  });

export type ChatMessage = z.infer<typeof chatMessageSchema>;
/** A message to append: the repository assigns `seq`. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type NewChatMessage = DistributiveOmit<ChatMessage, 'seq'>;

/** Validates a message for writing (seq is assigned by the store). */
export function parseNewChatMessage(input: unknown): NewChatMessage {
  // Never rethrow the ZodError: its message embeds issue paths and values.
  const parsed = chatMessageSchema.safeParse({ ...(input as object), seq: 1 });
  if (!parsed.success) throw new Error('chat_invalid_write');
  const m: Partial<ChatMessage> = parsed.data;
  delete m.seq;
  return m as NewChatMessage;
}

/** The raw column shape of a `chat_messages` row. */
export interface RawChatRow {
  id: unknown;
  day_key: unknown;
  seq: unknown;
  role: unknown;
  kind: unknown;
  payload: unknown;
  status: unknown;
  data_revision: unknown;
  created_at: unknown;
}

export type ChatRowResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; reason: 'bad_json' | 'bad_row' };

/**
 * A raw row, validated. Never throws and never echoes the row's content: the
 * reason is a fixed code, so a log line built from it cannot leak a message.
 */
export function parseChatRow(raw: RawChatRow): ChatRowResult {
  let payload: unknown;
  try {
    payload = typeof raw.payload === 'string' ? JSON.parse(raw.payload) : undefined;
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  const parsed = chatMessageSchema.safeParse({
    id: raw.id,
    dayKey: raw.day_key,
    seq: raw.seq,
    role: raw.role,
    kind: raw.kind,
    payload,
    status: raw.status,
    dataRevision: raw.data_revision,
    createdAt: raw.created_at,
  });
  return parsed.success ? { ok: true, message: parsed.data } : { ok: false, reason: 'bad_row' };
}
