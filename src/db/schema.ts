/**
 * Drizzle ORM schema for the on-device SQLite database (source of truth).
 * Drizzle emits parameterised statements, which is our structural defence
 * against SQL injection (non-negotiable #4).
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tag: text('tag'), // optional, cosmetic only — never affects net worth
  subtype: text('subtype'),
  currency: text('currency').notNull(),
  openingBalance: integer('opening_balance').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // 'expense' | 'income' | 'transfer'
  parentId: text('parent_id'),
  icon: text('icon'),
});

export const payees = sqliteTable('payees', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  defaultCategoryId: text('default_category_id'),
});

/** Single-row-per-key store for app-level preferences (e.g. display currency). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  type: text('type').notNull(), // 'expense' | 'income' | 'transfer'
  amount: integer('amount').notNull(), // minor units
  currency: text('currency').notNull(),
  categoryId: text('category_id'),
  payeeId: text('payee_id'),
  transferAccountId: text('transfer_account_id'),
  note: text('note'),
  occurredAt: integer('occurred_at').notNull(),
  createdAt: integer('created_at').notNull(),
  source: text('source').notNull(), // 'manual' | 'ai' | 'import'
  receiptRef: text('receipt_ref'),
  // The user's original utterance for an AI-logged entry, kept so the assistant
  // feed can show it as the right-side bubble. Null for manual/import entries.
  sourceText: text('source_text'),
});
