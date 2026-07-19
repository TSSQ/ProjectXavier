/**
 * Payee data access. Reads/writes go through Drizzle (parameterised SQL).
 *
 * `findOrCreateByName` resolves a free-text payee name (e.g. "Joe's Cafe") to a
 * payee, creating it on first use. When it creates a new payee it records the
 * supplied category as that payee's default ("first-used"), so picking the payee
 * later can auto-fill its category.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { payees } from '../../db/schema';
import { Payee } from '../../domain/types';
import { normalizeName } from '../../domain/payees';
import { newId } from '../../lib/id';
import { bumpDataRevision } from '../settings/repository';

export async function listPayees(): Promise<Payee[]> {
  const rows = await db.select().from(payees);
  return rows.map(rowToPayee);
}

export async function getPayeeByName(name: string): Promise<Payee | null> {
  // Case-insensitive match avoids duplicate payees. `name` is bound as a
  // parameter by drizzle's sql template, so this stays injection-safe.
  const rows = await db
    .select()
    .from(payees)
    .where(sql`lower(${payees.name}) = ${normalizeName(name)}`);
  return rows[0] ? rowToPayee(rows[0]) : null;
}

/**
 * Resolve a name to a payee id, creating it if new. A newly created payee
 * adopts `defaultCategoryId` as its first-used category. Existing payees keep
 * whatever default they already had.
 */
export async function findOrCreateByName(
  name: string,
  defaultCategoryId: string | null = null
): Promise<string> {
  const existing = await getPayeeByName(name);
  if (existing) return existing.id;

  const id = newId();
  await db.insert(payees).values({ id, name, defaultCategoryId });
  // A genuine new payee (not the early-return "already exists" branch
  // above) is new ledger content, e.g. created standalone from the "Add
  // payee" screen with no following createTransaction — must bump on its
  // own rather than relying on being "covered by construction".
  await bumpDataRevision();
  return id;
}

export async function updatePayee(
  id: string,
  patch: { name: string; defaultCategoryId?: string | null }
): Promise<void> {
  await db
    .update(payees)
    .set({ name: patch.name, defaultCategoryId: patch.defaultCategoryId ?? null })
    .where(eq(payees.id, id));
  await bumpDataRevision();
}

export async function deletePayee(id: string): Promise<void> {
  await db.delete(payees).where(eq(payees.id, id));
  await bumpDataRevision();
}

/** Remember (or change) the category a payee is normally used with. */
export async function setDefaultCategory(
  payeeId: string,
  categoryId: string | null
): Promise<void> {
  await db
    .update(payees)
    .set({ defaultCategoryId: categoryId })
    .where(eq(payees.id, payeeId));
  await bumpDataRevision();
}

function rowToPayee(row: typeof payees.$inferSelect): Payee {
  return {
    id: row.id,
    name: row.name,
    defaultCategoryId: row.defaultCategoryId ?? null,
  };
}
