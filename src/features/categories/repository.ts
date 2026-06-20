/**
 * Category data access. Reads/writes go through Drizzle (parameterised SQL).
 * `findOrCreateByName` lets the AI assistant resolve a free-text category name
 * (e.g. "Food") to an id, creating it on first use.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { categories } from '../../db/schema';
import { Category, TransactionType } from '../../domain/types';
import { newId } from '../../lib/id';

export async function listCategories(): Promise<Category[]> {
  const rows = await db.select().from(categories);
  return rows.map(rowToCategory);
}

export async function findOrCreateByName(
  name: string,
  kind: TransactionType
): Promise<string> {
  const existing = await db
    .select()
    .from(categories)
    .where(eq(categories.name, name));
  if (existing.length > 0) return existing[0]!.id;

  const id = newId();
  await db.insert(categories).values({ id, name, kind, parentId: null, icon: null });
  return id;
}

function rowToCategory(row: typeof categories.$inferSelect): Category {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as Category['kind'],
    parentId: row.parentId,
    icon: row.icon,
  };
}
