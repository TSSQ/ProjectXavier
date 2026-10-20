/**
 * A-Z ordering + quick-scroll index helpers. Framework-free.
 *
 * Display-level only: repositories keep returning insertion order because the
 * on-device FM grounding prompt is built from the caller's order. Never use
 * these on anything that feeds parse, prompts, budget math or backups.
 */

export const RAIL_LETTERS: readonly string[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '#',
];

export const RAIL_MIN_ITEMS = 15;

export function compareNames(a: string, b: string): number {
  const byLocale = a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
  if (byLocale !== 0) return byLocale;
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function sortByName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((x, y) => compareNames(x.name, y.name));
}

export function indexKey(name: string): string {
  const first = Array.from(name.trim())[0];
  if (!first) return '#';
  const base = first.normalize('NFD').charAt(0).toUpperCase();
  return base >= 'A' && base <= 'Z' && base.length === 1 ? base : '#';
}

export interface LetterGroup<T> {
  key: string;
  items: T[];
}

export function groupByLetter<T extends { name: string }>(
  items: readonly T[]
): LetterGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of sortByName(items)) {
    const key = indexKey(item.name);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return RAIL_LETTERS.filter((k) => buckets.has(k)).map((key) => ({
    key,
    items: buckets.get(key) as T[],
  }));
}

export function nearestPopulatedKey(
  key: string,
  populated: ReadonlySet<string>
): string | null {
  const start = RAIL_LETTERS.indexOf(key);
  if (start < 0) return null;
  for (let i = start; i < RAIL_LETTERS.length; i++) {
    if (populated.has(RAIL_LETTERS[i] as string)) return RAIL_LETTERS[i] as string;
  }
  for (let i = start - 1; i >= 0; i--) {
    if (populated.has(RAIL_LETTERS[i] as string)) return RAIL_LETTERS[i] as string;
  }
  return null;
}

/**
 * Map a touch y within a rail of `height` to one of `count` evenly spaced
 * slots, clamped to the ends. Null when the rail has no measurable size.
 */
export function letterIndexAt(y: number, height: number, count: number): number | null {
  if (height <= 0 || count <= 0) return null;
  return Math.min(count - 1, Math.max(0, Math.floor((y / height) * count)));
}

export function shouldShowRail(count: number, query: string): boolean {
  return count >= RAIL_MIN_ITEMS && query.trim() === '';
}
