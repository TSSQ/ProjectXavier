/**
 * Pure raw-row → validated-domain-object mapping for the plaintext-SQLite
 * restore path (assessment M3 fix — QA Blocker + Major).
 *
 * `SELECT * FROM src.<table>` on an attached backup file returns rows keyed
 * by the literal SQL column name (snake_case) with SQLite's native 0/1
 * integers for boolean-mode columns — NOT the camelCase/boolean-coerced
 * shape Drizzle's query builder produces. This module converts each raw row
 * to the domain shape and validates it through the EXISTING zod schemas
 * (src/lib/validation.ts) before it is ever allowed near a live-DB insert.
 *
 * Why this matters (the QA Blocker): a `.sqlite` file in the user's iCloud
 * Files app is a user-editable trust boundary (guardrail #6) — SQLite itself
 * has no strict column typing, so a raw `INSERT ... SELECT *` would happily
 * copy `amount = 'NOT_A_NUMBER'` or an out-of-range `type` straight into the
 * live DB with no error, silently corrupting every downstream money
 * calculation. Validating here, before any live table is touched, rejects
 * that file outright and leaves the live DB untouched.
 *
 * Why this also fixes the QA Major (cross-schema restore): the caller
 * assembles a `BackupData` from the validated rows and hands it to the
 * EXISTING `applyBackup` (src/features/backup/repository.ts), which inserts
 * with named columns (`db.insert(schema.transactions).values({ id: tx.id,
 * ... })`), not a positional `SELECT *` copy. A backup taken on an older
 * schema (missing e.g. `pending`/`seriesId`/`occurrenceDate`) is missing
 * those keys entirely after the raw→camelCase conversion below; zod's
 * `.optional()`/`.default()` on those exact fields fills in the same
 * defaults a fresh row would get, and the named-column insert doesn't care
 * that the source row had fewer columns than the live schema.
 *
 * Deliberately mirrors (does not import) the private `rowToX` mappers in
 * src/features/*\/repository.ts — importing them would drag expo-sqlite into
 * this module transitively, breaking Node-testability. No React Native /
 * Expo / DB imports here — Node-testable.
 */
import {
  accountSchema,
  categorySchema,
  payeeSchema,
  transactionReadSchema,
  recurringSeriesReadSchema,
  settingsRowSchema,
} from '../lib/validation';
import { Account, Category, Payee, Transaction, RecurringSeries } from './types';
import { BackupData } from '../lib/backup';

export type RawRow = Record<string, unknown>;

/** snake_case -> camelCase, e.g. "opening_balance" -> "openingBalance".
 *  Generic — a newly added snake_case column just gets its camelCase
 *  counterpart automatically; no per-field list to keep in sync. */
function toCamelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

/** Converts every key of a raw SQL row to camelCase. Values pass through
 *  unchanged — boolean/JSON coercion happens per-field below, only where the
 *  domain shape needs something other than the raw SQLite value. */
function toCamelRow(row: RawRow): RawRow {
  const out: RawRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[toCamelKey(key)] = value;
  }
  return out;
}

/**
 * SQLite has no boolean type — a Drizzle `{ mode: 'boolean' }` column comes
 * back from a raw (non-Drizzle) read as the integer 0/1. Coerces to a real
 * JS boolean, the same conversion Drizzle's own decode performs, but ONLY
 * for keys that are actually present: an absent (pre-migration) column stays
 * absent so the zod schema's `.default(...)` below decides the value,
 * rather than this function inventing one.
 */
function coerceBooleans(row: RawRow, keys: string[]): RawRow {
  const out = { ...row };
  for (const key of keys) {
    if (key in out && out[key] !== null && out[key] !== undefined) {
      out[key] = Boolean(out[key]);
    }
  }
  return out;
}

/**
 * A handful of domain fields (e.g. `Account.subtype`) are typed `T | undefined`
 * — optional, but NOT nullable — even though the SQL column is nullable, so a
 * raw SQL read's `null` needs converting to `undefined` before validation
 * (mirrors the equivalent `row.subtype ?? undefined` in the Drizzle-backed
 * `rowToAccount`, src/features/accounts/repository.ts). Most fields are typed
 * `T | null | undefined` and don't need this — only listed keys are touched.
 */
function nullToUndefined(row: RawRow, keys: string[]): RawRow {
  const out = { ...row };
  for (const key of keys) {
    if (out[key] === null) out[key] = undefined;
  }
  return out;
}

/** Parses a JSON text column (`rule`/`template`/`skipped_dates`), surfacing
 *  a clear, column-scoped error instead of a raw `SyntaxError` when the
 *  column is missing or the text isn't valid JSON (a corrupt/foreign file). */
function parseJsonColumn(value: unknown, columnLabel: string): unknown {
  if (typeof value !== 'string') {
    throw new Error(`${columnLabel} is missing or not a string`);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${columnLabel} is not valid JSON`);
  }
}

// KEEP IN SYNC: the `coerceBooleans`/`nullToUndefined`/`parseJsonColumn`
// argument lists below are the ONLY per-table thing this module hand-lists
// (everything else — new plain columns — flows through automatically via
// the generic `toCamelRow`). If a column's mode changes in src/db/schema.ts
// (e.g. a new `{ mode: 'boolean' }` integer column, a new JSON-text column,
// or a new field typed optional-but-not-nullable like `Account.subtype`),
// update the matching `parseXRow` below AND the matching Drizzle-backed
// `rowToX` in src/features/*/repository.ts — they must decode the exact same
// raw value to the exact same domain shape, just from two different sources
// (a raw SQL row here vs. Drizzle's own decode there).

export function parseAccountRow(row: RawRow): Account {
  const camel = nullToUndefined(coerceBooleans(toCamelRow(row), ['archived']), ['subtype']);
  return accountSchema.parse(camel) as Account;
}

export function parseCategoryRow(row: RawRow): Category {
  return categorySchema.parse(toCamelRow(row)) as Category;
}

export function parsePayeeRow(row: RawRow): Payee {
  return payeeSchema.parse(toCamelRow(row)) as Payee;
}

/**
 * Uses the read/restore-tolerant `transactionReadSchema` — NOT the
 * write-strict `transactionSchema` — so a pre-existing self-transfer row
 * (review F2's bug, already persisted in build 42) is imported rather than
 * aborting the whole restore. Genuine corruption (bad amount/type/etc.)
 * still throws exactly as before; the row is later neutralised by
 * `signedDelta` and surfaced by the one-time scan for the user to repair.
 */
export function parseTransactionRow(row: RawRow): Transaction {
  const camel = coerceBooleans(toCamelRow(row), ['pending']);
  return transactionReadSchema.parse(camel) as Transaction;
}

/** Same read-tolerance as `parseTransactionRow`, for a series whose template
 *  is a self-transfer (see `recurringSeriesReadSchema`). */
export function parseRecurringSeriesRow(row: RawRow): RecurringSeries {
  const camel = coerceBooleans(toCamelRow(row), ['paused', 'archived']);
  const withParsedJson = {
    ...camel,
    rule: parseJsonColumn(camel['rule'], 'rule'),
    template: parseJsonColumn(camel['template'], 'template'),
    skippedDates:
      camel['skippedDates'] === undefined
        ? undefined
        : parseJsonColumn(camel['skippedDates'], 'skippedDates'),
  };
  return recurringSeriesReadSchema.parse(withParsedJson) as RecurringSeries;
}

export interface SettingsRow {
  key: string;
  value: string;
}

export function parseSettingsRow(row: RawRow): SettingsRow {
  return settingsRowSchema.parse(toCamelRow(row));
}

/** Raw rows for every backed-up table, keyed by SQL table name, exactly as
 *  read from the attached backup file (`SELECT * FROM src.<table>`). */
export interface RawBackupRows {
  accounts: RawRow[];
  categories: RawRow[];
  payees: RawRow[];
  settings: RawRow[];
  transactions: RawRow[];
  recurring_series: RawRow[];
}

/**
 * Validates and converts every raw row of every table into a `BackupData`,
 * throwing on the FIRST invalid row (naming the table and row index) rather
 * than silently dropping or coercing it. This runs entirely in JS, before any
 * live table is touched — a thrown error here means the caller must not wipe
 * anything, so the live DB is left completely untouched on rejection.
 */
export function buildBackupDataFromRows(rawRowsByTable: RawBackupRows): BackupData {
  const accounts = mapRows(rawRowsByTable.accounts, parseAccountRow, 'accounts');
  const categories = mapRows(rawRowsByTable.categories, parseCategoryRow, 'categories');
  const payees = mapRows(rawRowsByTable.payees, parsePayeeRow, 'payees');
  const settingsRows = mapRows(rawRowsByTable.settings, parseSettingsRow, 'settings');
  const transactions = mapRows(rawRowsByTable.transactions, parseTransactionRow, 'transactions');
  const recurringSeries = mapRows(
    rawRowsByTable.recurring_series,
    parseRecurringSeriesRow,
    'recurring_series',
  );

  const settings: Record<string, string> = {};
  for (const { key, value } of settingsRows) settings[key] = value;

  return { accounts, categories, payees, transactions, recurringSeries, settings };
}

function mapRows<T>(rows: RawRow[], parse: (row: RawRow) => T, table: string): T[] {
  return rows.map((row, index) => {
    try {
      return parse(row);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(`Backup file has an invalid row in "${table}" (row ${index}): ${reason}`);
    }
  });
}
