/**
 * Pure decision logic for the one-time plaintext -> encrypted DB migration
 * (assessment H4, docs/design/at-rest-encryption-sqlcipher-spec.md).
 *
 * No expo-sqlite / expo-file-system / expo-secure-store import here — the
 * decisions below ("does this DB need migrating?", "is it safe to swap the
 * newly-exported encrypted copy in?") are proven against injected probe
 * outcomes in the plain-Node BDD suite. The native glue that actually
 * produces those outcomes (PRAGMA key, sqlcipher_export, the file swap)
 * lives in src/db/client.ts and can't be exercised here.
 */

/** Result of running `SELECT count(*) FROM sqlite_master` on a handle. */
export type DbProbeOutcome = 'readable' | 'unreadable';

/**
 * What to do, given the keyed probe result and (only when the keyed probe
 * failed) the unkeyed probe result on the same file:
 *
 * - `none` — the keyed probe succeeded: either a fresh/empty DB just keyed
 *   for the first time, or an already-encrypted DB with the right key. No
 *   migration needed either way.
 * - `migrate` — the keyed probe failed but the SAME file opened with no key
 *   probes fine: it's a legacy plaintext DB. Safe to sqlcipher_export it.
 * - `key-missing-or-corrupt` — the keyed probe failed AND the unkeyed probe
 *   also failed. This file is neither plaintext nor openable with the key we
 *   have (e.g. the Keychain item was wiped/didn't migrate to this device).
 *   We cannot tell what it is, so we must not touch it — surface an error
 *   instead of silently creating a new DB over it.
 */
export type MigrationDecision =
  | { kind: 'none' }
  | { kind: 'migrate' }
  | { kind: 'key-missing-or-corrupt' };

/**
 * Decide what the migration step should do. `unkeyedProbe` is only
 * meaningful (and should only be supplied) when `keyedProbe` is
 * `'unreadable'` — the caller only needs to run the second, no-key probe in
 * that case.
 */
export function decideMigration(
  keyedProbe: DbProbeOutcome,
  unkeyedProbe?: DbProbeOutcome
): MigrationDecision {
  if (keyedProbe === 'readable') return { kind: 'none' };
  return unkeyedProbe === 'readable'
    ? { kind: 'migrate' }
    : { kind: 'key-missing-or-corrupt' };
}

/** Row counts for every table checked, keyed by table name. */
export type RowCounts = Record<string, number>;

/**
 * The verify-before-delete gate. Never returns true unless the freshly
 * exported encrypted copy actually opened with the key — and, if the
 * plaintext source had any tables at all, has an identical row count to it
 * for every one of them. Only when this returns true is it safe to delete
 * the plaintext file and swap the encrypted copy into its place — this is
 * the sole guard standing between an interrupted/corrupt export and
 * permanent data loss.
 *
 * A plaintext source with zero tables (e.g. a legacy install that crashed
 * before its very first schema migration ever ran) has no data to lose, so
 * it verifies trivially as long as the copy opens with the key. Requiring a
 * non-empty match here would instead permanently brick every future launch
 * for that install (the count "mismatch" — really just 0 tables either
 * side — would never resolve), which is the opposite of the one-time
 * migration the spec intends.
 */
export function migrationVerified(
  encryptedCopyOpensWithKey: boolean,
  plaintextCounts: RowCounts,
  encryptedCounts: RowCounts
): boolean {
  if (!encryptedCopyOpensWithKey) return false;
  const tables = Object.keys(plaintextCounts);
  if (tables.length === 0) return true;
  return tables.every((table) => plaintextCounts[table] === encryptedCounts[table]);
}

/** On-disk presence of the canonical DB file and the scratch encrypted-
 *  export file, checked before either is opened. */
export interface StartupFilesystemState {
  dbExists: boolean;
  encExists: boolean;
}

/**
 * - `none` — nothing to recover; proceed as normal (an existing DB opens and
 *   probes as usual; a missing DB with no enc file either is a fresh
 *   install).
 * - `recover-move-enc-to-db` — the canonical DB is missing but a verified
 *   encrypted export exists: the process died after `swapInEncryptedFile`
 *   deleted the plaintext original but before it moved the encrypted copy
 *   into place. That encrypted copy is now the ONLY surviving copy of the
 *   user's data — it must be moved into place, never discarded.
 * - `discard-stale-enc` — both files exist: the canonical DB (still
 *   plaintext) is intact and remains the source of truth (the process died
 *   before the delete step, or a stale export was left over from an earlier
 *   failed attempt either way). The lingering enc file is unverified and
 *   safe to discard; the normal plaintext-probe -> migrate path re-exports a
 *   fresh copy if the DB does turn out to be plaintext.
 */
export type StartupRecoveryAction = 'none' | 'recover-move-enc-to-db' | 'discard-stale-enc';

/**
 * Decides the pre-open recovery action from the on-disk presence of the two
 * files alone, before either is opened. Runs every launch, ahead of the
 * normal keyed-probe migration path, specifically to repair a
 * `swapInEncryptedFile` interrupted between its two non-atomic steps (delete
 * the plaintext original, then move the verified encrypted copy into its
 * place) — see docs/design/at-rest-encryption-sqlcipher-spec.md.
 */
export function decideStartupRecovery(state: StartupFilesystemState): StartupRecoveryAction {
  if (!state.encExists) return 'none';
  return state.dbExists ? 'discard-stale-enc' : 'recover-move-enc-to-db';
}

/**
 * The `-wal` / `-shm` sidecar filenames SQLite maintains next to a db file
 * opened in WAL journal mode (this app always opens with
 * `enableChangeListener: true`, which requires WAL). A stale sidecar written
 * under one key/salt sitting next to a db file now opened under a DIFFERENT
 * key is a corruption vector ("disk image malformed", or silently ignored) —
 * every delete/move of a db file in src/db/client.ts must take its sidecars
 * with it, not just the main file. Pure string derivation; the actual file
 * I/O is native glue that belongs to the simulator smoke test.
 */
export function dbSidecarNames(dbFileName: string): [string, string] {
  return [`${dbFileName}-wal`, `${dbFileName}-shm`];
}
