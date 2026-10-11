/**
 * Phrase-memory data access (src/domain/phraseMemory.ts). Drizzle only, so
 * every statement is parameterised (guardrail #4). The write sequences live
 * in ./remember.ts; this file wires them to the real table.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { phraseMemory } from '../../db/schema';
import { PhraseMemoryRow } from '../../domain/phraseMemory';
import { phraseMemoryRowSchema } from '../../lib/validation';
import { Transaction } from '../../domain/types';
import { PhraseMemoryStore, rememberConfirmed } from './remember';

/** Rows are validated on read too: a row that does not parse is skipped,
 *  never applied. */
function toRow(raw: unknown): PhraseMemoryRow | null {
  const parsed = phraseMemoryRowSchema.safeParse(raw);
  return parsed.success ? (parsed.data as PhraseMemoryRow) : null;
}

export async function listPhraseMemory(): Promise<PhraseMemoryRow[]> {
  const rows = await db.select().from(phraseMemory);
  return rows.map(toRow).filter((r): r is PhraseMemoryRow => r !== null);
}

export const phraseMemoryStore: PhraseMemoryStore = {
  async get(key) {
    const rows = await db.select().from(phraseMemory).where(eq(phraseMemory.key, key));
    return rows[0] ? toRow(rows[0]) : null;
  },
  async put(row) {
    const valid = phraseMemoryRowSchema.parse(row);
    await db
      .insert(phraseMemory)
      .values(valid)
      .onConflictDoUpdate({
        target: phraseMemory.key,
        set: {
          verdict: valid.verdict,
          type: valid.type,
          categoryId: valid.categoryId,
          payeeId: valid.payeeId,
          accountId: valid.accountId,
          hits: valid.hits,
          reverts: valid.reverts,
          lastUsedAt: valid.lastUsedAt,
          updatedAt: valid.updatedAt,
        },
      });
  },
  async remove(key) {
    await db.delete(phraseMemory).where(eq(phraseMemory.key, key));
  },
  list: listPhraseMemory,
};

/** An AI-logged transaction was edited after saving: what its words meant is
 *  now what the user saved. Best-effort (never throws); nothing for a row
 *  that is not AI-sourced or carries no words. */
export function rememberTransactionEdit(
  tx: Pick<Transaction, 'source' | 'sourceText' | 'type' | 'categoryId' | 'payeeId' | 'accountId'>
): Promise<void> {
  if (tx.source !== 'ai' || !tx.sourceText) return Promise.resolve();
  return rememberConfirmed(
    phraseMemoryStore,
    tx.sourceText,
    {
      type: tx.type,
      categoryId: tx.categoryId ?? null,
      payeeId: tx.payeeId ?? null,
      accountId: tx.accountId,
    },
    Date.now()
  );
}
