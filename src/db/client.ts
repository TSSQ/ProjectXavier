/**
 * Drizzle + expo-sqlite client (app runtime only).
 *
 * Kept separate from pure logic so the test suite never imports React Native.
 * The database is opened on-device and is the source of truth; the DB file
 * itself is encrypted at rest with SQLCipher (see ./encryptionKey.ts and
 * docs/design/at-rest-encryption-sqlcipher-spec.md). Exported backups
 * (src/lib/backup.ts) are still plaintext JSON — that's M3, deferred.
 *
 * `initDb()` must be awaited before `db`/`expoDb` are used (see app/_layout.tsx).
 * It is async because the key comes from the Keychain and `PRAGMA key` must be
 * the very first statement run on the handle, before any query — including
 * the schema migration in ./migrate.ts. Accessing `db`/`expoDb` before
 * `initDb()` resolves throws instead of silently running against `undefined`.
 */
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { Directory, File } from 'expo-file-system';
import {
  defaultDatabaseDirectory,
  openDatabaseSync,
  SQLiteDatabase,
} from 'expo-sqlite';
import { getOrCreateDbKey } from './encryptionKey';
import {
  decideMigration,
  decideStartupRecovery,
  dbSidecarNames,
  migrationVerified,
  DbProbeOutcome,
  RowCounts,
  StartupFilesystemState,
} from './encryptionMigrationPlan';
import * as schema from './schema';

const DB_NAME = 'projectxavier.db';
const ENC_NAME = 'projectxavier.enc.db';

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _expoDbReal: SQLiteDatabase | undefined;
let _dbReal: DrizzleDb | undefined;
let initPromise: Promise<void> | undefined;

/**
 * Wraps a not-yet-available real object (the keyed SQLiteDatabase handle /
 * Drizzle instance) so repositories can keep `import { db, expoDb } from
 * './client'` unchanged, while any access before `initDb()` resolves throws a
 * clear diagnostic instead of an opaque "Cannot read properties of undefined".
 * Functions are rebound to the real object so `this` is correct once it
 * exists — the proxy target itself is never touched again after that.
 */
function guarded<T extends object>(getReal: () => T | undefined, label: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const real = getReal();
      if (real === undefined) {
        throw new Error(
          `${label} accessed before initDb() completed — await initDb() at app ` +
            'startup before running any query.'
        );
      }
      const value = Reflect.get(real as object, prop, real as object);
      return typeof value === 'function' ? value.bind(real) : value;
    },
    has(_target, prop) {
      const real = getReal();
      return real !== undefined && Reflect.has(real as object, prop);
    },
  });
}

/** Raw handle for DDL/PRAGMA that doesn't go through Drizzle (see migrate.ts). */
export const expoDb: SQLiteDatabase = guarded(() => _expoDbReal, 'expoDb');
export const db: DrizzleDb = guarded(() => _dbReal, 'db');
export { schema };

/** Whether `initDb()` has completed successfully — lets callers that can't
 *  (or shouldn't) await it check first rather than triggering the guarded
 *  proxies' thrown diagnostic (see app/_layout.tsx's AppState listener). */
export function isDbReady(): boolean {
  return _dbReal !== undefined;
}

/**
 * Opens the on-device DB (keyed with SQLCipher), migrating a legacy plaintext
 * DB in place if one is found, and wires up Drizzle. Safe to call more than
 * once — later calls are a no-op once initialisation has succeeded. Must be
 * awaited (see app/_layout.tsx) before any query runs.
 */
export function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = doInitDb().catch((e) => {
      // Don't wedge the app in a permanently-failed state on a transient
      // error — a later retry starts the (crash-safe) sequence over.
      initPromise = undefined;
      throw e;
    });
  }
  return initPromise;
}

async function doInitDb(): Promise<void> {
  const hex = await getOrCreateDbKey();

  // Repair a swap interrupted between its two non-atomic steps (delete the
  // plaintext original, then move the verified encrypted copy into place)
  // BEFORE ever opening DB_NAME — otherwise a missing DB_NAME with an
  // orphaned, fully-verified ENC_NAME sitting next to it would just open as
  // a brand-new EMPTY encrypted DB, silently losing every row that made it
  // through the (already-verified) export. See encryptionMigrationPlan.ts.
  recoverStartupFilesystemState(hex);

  let handle = openDatabaseSync(DB_NAME, { enableChangeListener: true });
  keyConnection(handle, hex);

  if (probe(handle) === 'unreadable') {
    handle = await migrateToEncrypted(handle, hex);
  }

  _expoDbReal = handle;
  _dbReal = drizzle(handle, { schema });
}

/** `PRAGMA key` in the raw-key blob form — must be the first statement run
 *  on any handle before it can be queried. The key itself must never be
 *  logged (see encryptionKey.ts): a raw driver error here could otherwise
 *  echo the SQL text — and therefore the hex key — into console.error / the
 *  "Startup failed: <msg>" splash, so the original error is never forwarded. */
function keyConnection(handle: SQLiteDatabase, hex: string): void {
  try {
    handle.execSync(`PRAGMA key = "x'${hex}'";`);
  } catch {
    throw new Error('failed to apply database key');
  }
}

/** The keyed/unkeyed detection probe: reads fine on a fresh or already-
 *  correctly-keyed DB, throws on anything else (plaintext, or wrong/missing
 *  key). */
function probe(handle: SQLiteDatabase): DbProbeOutcome {
  try {
    handle.getFirstSync('SELECT count(*) FROM sqlite_master;');
    return 'readable';
  } catch {
    return 'unreadable';
  }
}

/** Row counts for every user table in `handle`, used to verify the migration
 *  didn't lose data. Table names come from sqlite_master itself (schema-
 *  derived, not user input), matching the existing PRAGMA table_info pattern
 *  in migrate.ts. */
function readRowCounts(handle: SQLiteDatabase): RowCounts {
  const tables = handle.getAllSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
  );
  const counts: RowCounts = {};
  for (const { name } of tables) {
    const row = handle.getFirstSync<{ c: number }>(`SELECT count(*) AS c FROM "${name}";`);
    counts[name] = row?.c ?? 0;
  }
  return counts;
}

/** The SQLite directory `File`/`Directory` handles resolve into — the same
 *  physical folder expo-sqlite opens `DB_NAME`/`ENC_NAME` from
 *  (`defaultDatabaseDirectory`, a plain filesystem path; expo-file-system
 *  needs a `file://` URI). */
function sqliteDir(): Directory {
  const plain = defaultDatabaseDirectory as string;
  return new Directory(plain.startsWith('file://') ? plain : `file://${plain}`);
}

function dbFile(name: string): File {
  return new File(sqliteDir(), name);
}

function deleteFileIfExists(file: File): void {
  if (file.exists) file.delete();
}

/**
 * Deletes `name` (if present) together with its `-wal`/`-shm` sidecars (if
 * present). WAL-mode SQLite (this app always opens with
 * `enableChangeListener: true`) keeps live data in those sidecars — a stale
 * one written under a different key/salt sitting next to a db file now
 * opened under a DIFFERENT key is a corruption vector ("disk image
 * malformed", or silently ignored), not just clutter. Every delete/replace
 * of a db file (swap, recovery, discarding a stale export) goes through
 * this so none of them can leave an orphaned sidecar behind. Every delete is
 * existence-guarded, so a missing sidecar is always a safe no-op.
 */
function deleteDbWithSidecars(name: string): void {
  deleteFileIfExists(dbFile(name));
  for (const sidecar of dbSidecarNames(name)) {
    deleteFileIfExists(dbFile(sidecar));
  }
}

/**
 * Pre-open recovery: inspects the filesystem state alone (neither file is
 * opened for this check) and repairs a `swapInEncryptedFile` interrupted
 * mid-way. See `decideStartupRecovery` for what each outcome means.
 *
 * Throws — without touching either file — if the recovery case can't
 * safely complete (the orphaned enc copy exists but won't open with the key
 * we have): DB_NAME is missing, so silently proceeding would just create a
 * brand-new empty DB over an unrecoverable-but-still-present orphan.
 */
function recoverStartupFilesystemState(hex: string): void {
  const state: StartupFilesystemState = {
    dbExists: dbFile(DB_NAME).exists,
    encExists: dbFile(ENC_NAME).exists,
  };
  const action = decideStartupRecovery(state);

  if (action === 'none') return;

  if (action === 'discard-stale-enc') {
    // DB_NAME (still plaintext) is intact and remains the source of truth;
    // the lingering enc file is unverified either way — discard it now
    // rather than leaving it to be rediscovered deep inside
    // migrateToEncrypted (which would otherwise do the exact same thing).
    discardStaleEncFile();
    return;
  }

  // action === 'recover-move-enc-to-db': DB_NAME is missing, so this
  // orphaned enc file is the ONLY surviving copy of the user's data.
  // Re-verify it actually opens with our key before trusting it — do not
  // move an unopenable file into the canonical path.
  const { encOpens } = openAndProbeEncCopy(hex);
  if (!encOpens) {
    throw new Error(
      `${DB_NAME} is missing and the orphaned ${ENC_NAME} next to it will ` +
        'not open with the stored key — refusing to recover it ' +
        'automatically. Restore the Keychain item or restore from a backup ' +
        'before relaunching.'
    );
  }
  // DB_NAME's own main file is already gone (that's why we're here), but a
  // stale plaintext -wal/-shm can still survive an interrupted delete step —
  // never let one sit next to the just-recovered encrypted DB.
  deleteDbWithSidecars(DB_NAME);
  dbFile(ENC_NAME).move(dbFile(DB_NAME));
  // Only the main file moves — clean up any sidecars left behind under the
  // old ENC_NAME (same root cause; tidy either way).
  deleteDbWithSidecars(ENC_NAME);
}

/**
 * Migrates a legacy plaintext `DB_NAME` to an encrypted copy in place.
 * Verify-before-delete: the plaintext file is never touched until the
 * exported copy is proven to open with the key and match every table's row
 * count. Returns a freshly (re)opened, keyed handle on `DB_NAME`.
 *
 * Throws — leaving the plaintext file completely untouched — if the file
 * turns out not to be plaintext after all (the "key missing but DB already
 * encrypted" edge case: neither the key we have nor no key can read it).
 */
async function migrateToEncrypted(
  keyedHandle: SQLiteDatabase,
  hex: string
): Promise<SQLiteDatabase> {
  // The keyed handle can't read this file — close it and reopen the SAME
  // file with no key at all, to find out whether it's really plaintext
  // (as opposed to encrypted under a key we don't have).
  keyedHandle.closeSync();
  const plainHandle = openDatabaseSync(DB_NAME, { useNewConnection: true });
  const unkeyedProbe = probe(plainHandle);

  const decision = decideMigration('unreadable', unkeyedProbe);
  if (decision.kind === 'key-missing-or-corrupt') {
    plainHandle.closeSync();
    throw new Error(
      'The local database appears to be encrypted, but the stored key could ' +
        'not open it. Refusing to overwrite it — restore the Keychain item or ' +
        'restore from a backup.'
    );
  }

  try {
    const plaintextCounts = readRowCounts(plainHandle);

    // Crash-safety: a previous migration may have been interrupted after
    // exporting but before the swap. Any leftover `.enc.db` is unverified by
    // definition — always discard it and export fresh from the still-intact
    // plaintext source.
    discardStaleEncFile();

    const encPath = `${(defaultDatabaseDirectory as string).replace(/\/+$/, '')}/${ENC_NAME}`;
    try {
      // Never forward the raw driver error verbatim here either — it could
      // echo this SQL (and therefore the hex key) into console.error / the
      // startup-failed splash. See keyConnection()'s comment.
      plainHandle.execSync(`ATTACH DATABASE '${encPath}' AS enc KEY "x'${hex}'";`);
    } catch {
      throw new Error('failed to apply database key');
    }
    plainHandle.execSync(`SELECT sqlcipher_export('enc');`);
    plainHandle.execSync('DETACH DATABASE enc;');

    const { encOpens, encCounts } = openAndProbeEncCopy(hex);

    if (!migrationVerified(encOpens, plaintextCounts, encCounts)) {
      throw new Error(
        'Encrypted database export failed verification (row counts did not ' +
          'match) — the plaintext database was left untouched.'
      );
    }
  } finally {
    plainHandle.closeSync();
  }

  swapInEncryptedFile();

  const reopened = openDatabaseSync(DB_NAME, {
    enableChangeListener: true,
    useNewConnection: true,
  });
  try {
    keyConnection(reopened, hex);
  } catch (e) {
    reopened.closeSync();
    throw e;
  }
  return reopened;
}

function discardStaleEncFile(): void {
  deleteDbWithSidecars(ENC_NAME);
}

function openAndProbeEncCopy(hex: string): { encOpens: boolean; encCounts: RowCounts } {
  const encHandle = openDatabaseSync(ENC_NAME, { useNewConnection: true });
  try {
    keyConnection(encHandle, hex);
    if (probe(encHandle) !== 'readable') return { encOpens: false, encCounts: {} };
    return { encOpens: true, encCounts: readRowCounts(encHandle) };
  } catch {
    return { encOpens: false, encCounts: {} };
  } finally {
    encHandle.closeSync();
  }
}

/** Only reached after `migrationVerified` returns true. Deletes the
 *  plaintext `DB_NAME` (and its `-wal`/`-shm` sidecars — a stale plaintext
 *  WAL next to the freshly-swapped-in encrypted file is a corruption
 *  vector, not just clutter) and atomically renames the verified `ENC_NAME`
 *  onto its path — the same delete-then-move pattern already used for the
 *  widget-summary write (see src/features/widget/summary.ts). */
function swapInEncryptedFile(): void {
  deleteDbWithSidecars(DB_NAME);
  dbFile(ENC_NAME).move(dbFile(DB_NAME));
  // Only the main file moved — clean up any sidecars left behind under the
  // old ENC_NAME (same root cause; tidy either way).
  deleteDbWithSidecars(ENC_NAME);
}
