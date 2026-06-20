/**
 * Payee data access. Reads/writes go through Drizzle (parameterised SQL).
 * `findOrCreateByName` resolves a free-text payee name (e.g. "Joe's Cafe") to
 * an id, creating it on first use.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { payees } from '../../db/schema';
import { Payee } from '../../domain/types';
import { newId } from '../../lib/id';

export async function listPayees(): Promise<Payee[]> {
  const rows = await db.select().from(payees);
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function findOrCreateByName(name: string): Promise<string> {
  // Case-insensitive match avoids duplicate payees. `name` is bound as a
  // parameter by drizzle's sql template, so this stays injection-safe.
  const existing = await db
    .select()
    .from(payees)
    .where(sql`lower(${payees.name}) = lower(${name})`);
  if (existing.length > 0) return existing[0]!.id;

  const id = newId();
  await db.insert(payees).values({ id, name });
  return id;
}
