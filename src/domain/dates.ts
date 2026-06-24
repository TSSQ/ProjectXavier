/**
 * Small, framework-free date helpers. Pure so they're unit-testable in plain
 * Node and shareable between the transaction form (date picker) and the
 * assistant feed (today's-entries filter). Display format across the app is
 * dd-MM-yyyy.
 */

/** Format epoch ms as `dd-MM-yyyy` (the app's display + transaction date format). */
export function formatDMY(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

/** Midnight (local) at the start of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** True when two epoch-ms timestamps fall on the same local calendar day. */
export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
