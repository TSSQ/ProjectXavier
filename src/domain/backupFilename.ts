/**
 * Pure backup-filename conventions (assessment M3: plaintext-SQLite backups).
 *
 * Two formats can be present in a user's iCloud container:
 *  - `.sqlite` — new backups: a whole-DB plaintext SQLite image (see
 *    src/features/backup/sqliteFile.ts).
 *  - `.json`   — legacy backups: plaintext JSON (see src/lib/backup.ts).
 *    Restore-only; no new `.json` backups are ever written.
 *
 * No React Native / Expo / DB imports — Node-testable. The RN-facing adapter
 * (src/features/backup/icloud.ts) re-exports `buildName`/`parseExportedAt` so
 * callers keep a single import surface.
 */

const PREFIX = 'projectxavier-backup-';

export const SQLITE_SUFFIX = '.sqlite';
export const JSON_SUFFIX = '.json';

/** Recognised suffixes, newest-format first (order doesn't affect matching —
 *  the two never overlap — but keeps the "new format" convention visible). */
const RECOGNISED_SUFFIXES = [SQLITE_SUFFIX, JSON_SUFFIX] as const;

/**
 * Build the filename for a new backup with the given exportedAt timestamp.
 * New backups are always `.sqlite` — there is no code path that writes `.json`
 * anymore.
 */
export function buildName(exportedAt: number): string {
  return `${PREFIX}${exportedAt}${SQLITE_SUFFIX}`;
}

/**
 * Parse the exportedAt timestamp out of a filename, recognising BOTH the new
 * `.sqlite` and legacy `.json` conventions. Returns null if the name matches
 * neither (so callers can filter out unrelated files in the same container).
 */
export function parseExportedAt(name: string): number | null {
  for (const suffix of RECOGNISED_SUFFIXES) {
    if (name.startsWith(PREFIX) && name.endsWith(suffix)) {
      const ts = Number(name.slice(PREFIX.length, name.length - suffix.length));
      return Number.isFinite(ts) ? ts : null;
    }
  }
  return null;
}

export type RestoreRoute = 'sqlite' | 'json';

/**
 * Which restore path a backup filename should take. Only meaningful for
 * names that already pass `parseExportedAt` (i.e. came from `list()`), but is
 * a total function: anything not ending in `.sqlite` is routed to the legacy
 * `.json` path.
 */
export function restoreRouteFor(name: string): RestoreRoute {
  return name.endsWith(SQLITE_SUFFIX) ? 'sqlite' : 'json';
}
