/**
 * Category data access. Reads/writes go through Drizzle (parameterised SQL).
 * `findOrCreateByName` lets the AI assistant resolve a free-text category name
 * (e.g. "Food") to an id, creating it on first use.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { categories } from '../../db/schema';
import { Category, TransactionType } from '../../domain/types';
import { newId } from '../../lib/id';
import { bumpDataRevision } from '../settings/repository';

export async function listCategories(): Promise<Category[]> {
  const rows = await db.select().from(categories);
  return rows.map(rowToCategory);
}

export async function findOrCreateByName(
  name: string,
  kind: TransactionType
): Promise<string> {
  // Case-insensitive match avoids "Food"/"food" duplicates, scoped to `kind` so
  // an expense "Travel" and an income "Travel" stay distinct categories (they
  // have separate icon/parent taxonomies and are filtered by kind everywhere in
  // the UI). Without the kind filter, saving an expense "Travel" would silently
  // reuse an existing income "Travel". `name`/`kind` are bound as parameters by
  // drizzle's sql template, so this stays injection-safe.
  const existing = await db
    .select()
    .from(categories)
    .where(sql`lower(${categories.name}) = lower(${name}) and ${categories.kind} = ${kind}`);
  if (existing.length > 0) return existing[0]!.id;

  const id = newId();
  await db.insert(categories).values({ id, name, kind, parentId: null, icon: null });
  // A genuine new category (not the early-return "already exists" branch
  // above) is new ledger content, e.g. created standalone from the "Add
  // payee" screen with no following createTransaction — must bump on its
  // own rather than relying on being "covered by construction".
  await bumpDataRevision();
  return id;
}

export async function createCategory(
  name: string,
  kind: TransactionType,
  icon?: string | null
): Promise<Category> {
  const id = newId();
  await db.insert(categories).values({ id, name, kind, parentId: null, icon: icon ?? null });
  await bumpDataRevision();
  return { id, name, kind, parentId: null, icon: icon ?? null };
}

export async function updateCategory(
  id: string,
  patch: { name: string; kind: TransactionType; icon?: string | null }
): Promise<void> {
  await db
    .update(categories)
    .set({ name: patch.name, kind: patch.kind, icon: patch.icon ?? null })
    .where(eq(categories.id, id));
  await bumpDataRevision();
}

export async function deleteCategory(id: string): Promise<void> {
  await db.delete(categories).where(eq(categories.id, id));
  await bumpDataRevision();
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
