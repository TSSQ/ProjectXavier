/**
 * Pure backup-filename conventions (assessment M3: plaintext-SQLite backups;
 * iCloud sync spec: device idiom in the filename).
 *
 * Two formats can be present in a user's iCloud container:
 *  - `.sqlite` — new backups: a whole-DB plaintext SQLite image (see
 *    src/features/backup/sqliteFile.ts).
 *  - `.json`   — legacy backups: plaintext JSON (see src/lib/backup.ts).
 *    Restore-only; no new `.json` backups are ever written.
 *
 * Since docs/design/icloud-backup-sync-spec.md (I5), a `.sqlite` name MAY
 * also carry which idiom made it: `projectxavier-backup-<ts>-<iPhone|iPad>.sqlite`.
 * The device segment is an enum, not free text — nothing to sanitise — and
 * an unknown segment (a future version of this app, or a different device
 * kind) still parses (the timestamp is still recovered); it just maps to
 * `device: null` rather than rejecting the whole file. `.json` names never
 * carry a device segment at all (no new `.json` is ever written, and the
 * parser enforces this — a `.json` name with a hyphenated segment doesn't
 * parse as "device: null", it's rejected outright, same as any other
 * unrelated file) — QA round 1 caught this actually being permissive.
 *
 * The timestamp is capped at 15 digits (`\d{1,15}`) — ~31,700 years of
 * headroom past any real epoch-ms value and comfortably under
 * `Number.MAX_SAFE_INTEGER` (16 digits), so a corrupt/adversarial filename
 * with dozens of digits can't silently round-trip through `Number()` into
 * `1e+29` (QA round 1).
 *
 * No React Native / Expo / DB imports — Node-testable. The RN-facing adapter
 * (src/features/backup/icloud.ts) re-exports `buildName` so callers keep a
 * single import surface for it.
 */

const PREFIX = 'projectxavier-backup-';

export const SQLITE_SUFFIX = '.sqlite';
export const JSON_SUFFIX = '.json';

/** The two idioms this app ships on. A future device kind (or a name minted
 *  by a future app version) is deliberately NOT added here defensively —
 *  see `parseBackupName`, which maps anything else to `device: null` instead
 *  of rejecting the file. */
export type BackupDevice = 'iPhone' | 'iPad';

const BACKUP_DEVICES: readonly BackupDevice[] = ['iPhone', 'iPad'];

function isBackupDevice(value: string): value is BackupDevice {
  return (BACKUP_DEVICES as readonly string[]).includes(value);
}

/** Timestamp digit cap — see the module doc comment. */
const TS = '\\d{1,15}';

/** `PREFIX` + digits + optional `-<segment>` + `.sqlite`. The device segment
 *  is any alphanumeric run at parse time (see `parseBackupName`) —
 *  membership in `BackupDevice` is checked separately, so a segment this
 *  regex doesn't recognise as `iPhone`/`iPad` still lets the rest of the
 *  name parse instead of failing the whole match. Alphanumeric, not "any
 *  non-dot character" (QA round 3 nit): path-safety for this segment is
 *  structural — no `/`, `.`, or other separator can ever reach it — rather
 *  than resting on it happening to come from a trusted filesystem listing
 *  today. `.json` has its own regex below with NO device group — a `.json`
 *  name never carries one, by construction, not just by convention. */
const SQLITE_NAME_RE = new RegExp(`^${PREFIX}(${TS})(?:-([A-Za-z0-9]+))?\\.sqlite$`);
const JSON_NAME_RE = new RegExp(`^${PREFIX}(${TS})\\.json$`);

/**
 * Build the filename for a new backup with the given exportedAt timestamp,
 * optionally naming the device idiom that made it. New backups are always
 * `.sqlite` — there is no code path that writes `.json` anymore.
 *
 * `device` is optional so existing callers that predate the iCloud sync
 * spec keep compiling and producing the exact same (device-less) filename
 * they always have; `src/features/backup/repository.ts`'s
 * `createBackupUnlocked` passes `deviceKind()` explicitly.
 */
export function buildName(exportedAt: number, device?: BackupDevice): string {
  const deviceSegment = device ? `-${device}` : '';
  return `${PREFIX}${exportedAt}${deviceSegment}${SQLITE_SUFFIX}`;
}

export interface ParsedBackupName {
  exportedAt: number;
  /** `null` for a legacy (device-less) name, a `.json` name (which never
   *  carries one), or a segment this app version doesn't recognise. */
  device: BackupDevice | null;
  format: 'sqlite' | 'json';
}

/**
 * Parse a backup filename into its timestamp, optional device idiom, and
 * format. Returns null if `name` matches neither the new `.sqlite` nor
 * legacy `.json` convention (so callers can filter out unrelated files in
 * the same container) — this is a total function otherwise: an unrecognised
 * device segment on a `.sqlite` name does not reject the file, it just
 * resolves to `device: null` (see the module doc comment); a device-shaped
 * segment on a `.json` name DOES reject the file — `.json` has no such
 * grammar at all.
 *
 * No `Number.isFinite` guard on the parsed timestamp (QA round 3 minor 7 —
 * removed; it was dead code): `TS` (`\\d{1,15}`) only ever captures 1-15
 * decimal digits, which `Number()` always turns into a finite value —
 * there's no digit sequence this regex can produce that overflows to
 * `Infinity` or parses to `NaN`.
 */
export function parseBackupName(name: string): ParsedBackupName | null {
  const sqliteMatch = SQLITE_NAME_RE.exec(name);
  if (sqliteMatch) {
    const exportedAt = Number(sqliteMatch[1]);
    const deviceSegment = sqliteMatch[2];
    const device: BackupDevice | null =
      deviceSegment !== undefined && isBackupDevice(deviceSegment) ? deviceSegment : null;
    return { exportedAt, device, format: 'sqlite' };
  }

  const jsonMatch = JSON_NAME_RE.exec(name);
  if (jsonMatch) {
    const exportedAt = Number(jsonMatch[1]);
    return { exportedAt, device: null, format: 'json' };
  }

  return null;
}

export type RestoreRoute = 'sqlite' | 'json';

/**
 * Which restore path a backup filename should take. Only meaningful for
 * names that already pass `parseBackupName` (i.e. came from `list()`), but
 * is a total function: anything not ending in `.sqlite` is routed to the
 * legacy `.json` path.
 */
export function restoreRouteFor(name: string): RestoreRoute {
  return name.endsWith(SQLITE_SUFFIX) ? 'sqlite' : 'json';
}
