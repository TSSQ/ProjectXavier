# Spec: fix assessment H4 — encrypt the SQLite DB at rest (SQLCipher)

Source: `docs/assessment-2026-07-12.md`, finding **H4**. The DB is plaintext at
default file protection and rides device backups, so the Face ID gate protects
nothing at rest. Scope locked with the user: **DB encryption only** (encrypted
backups / M3 deferred), key in Keychain with **`AFTER_FIRST_UNLOCK`**.

**Probe-validated** (2026-07-12, iOS Simulator, this exact stack — SDK 54 /
expo-sqlite 16.0.10 / drizzle-orm 0.36.4): `useSQLCipher` compiles + integrates;
Drizzle works over a `PRAGMA key`ed connection; the plaintext→encrypted
migration round-trips with the migrated file provably unreadable without the
key. This spec bakes in the probe's confirmed recipe and gotchas.

## Objective

Every transaction, payee, and setting is encrypted at rest with AES (SQLCipher),
keyed by a 256-bit random key stored in the iOS Keychain (`AFTER_FIRST_UNLOCK`).
Existing users' plaintext DBs migrate to encrypted once, without data loss.
Backups remain plaintext JSON for now (M3), but the marketing/privacy copy is
made honest.

## Approach

### 1. Enable SQLCipher (native, `app.config.ts`)

Add the plugin prop: the `expo-sqlite` entry in `plugins` becomes
`['expo-sqlite', { ios: { useSQLCipher: true } }]`. This writes
`expo.sqlite.useSQLCipher=true` into `Podfile.properties.json`; the podspec then
vendors `sqlcipher` and compiles `-DSQLITE_HAS_CODEC=1 -DSQLCIPHER_CRYPTO_CC`
(Apple CommonCrypto). **Requires `expo prebuild -p ios` + `pod install`**, which
regenerates `ios/` — so the two-target manual-signing pbxproj patch MUST be
re-applied afterward (build memory `widget-build24-signing`; the release-manager
owns this in the /build step). Toggling this flag is the only reason prebuild is
needed; subsequent builds don't re-prebuild.

### 2. Key management (new `src/db/encryptionKey.ts`)

```
getOrCreateDbKey(): Promise<string>   // returns 64-hex (32 raw bytes)
```
- Read `db_encryption_key` from `expo-secure-store`. If present, return it.
- If absent: `expo-crypto` `getRandomBytesAsync(32)` → hex-encode → store via
  `SecureStore.setItemAsync('db_encryption_key', hex, { keychainAccessible:
  SecureStore.AFTER_FIRST_UNLOCK })` → return. (Verify the exact accessibility
  constant name against installed `expo-secure-store` — probe used
  `AFTER_FIRST_UNLOCK`.)
- Framework-bound (SecureStore/Crypto), so it lives under `src/db/`, not the
  framework-free domain layer.

### 3. Async DB client (`src/db/client.ts` — the core refactor)

Today the client opens the DB and wires Drizzle **synchronously at module
import**. That's incompatible with SQLCipher: the key fetch is async and
`PRAGMA key` must be the **first statement** on the handle, before any query.

- Replace the top-level init with an idempotent `export async function initDb():
  Promise<void>` that: `getOrCreateDbKey()` → `openDatabaseSync('projectxavier.db',
  { enableChangeListener: true })` → **immediately** `expoDb.execSync(\`PRAGMA key
  = "x'\${hex}'"\`)` (raw-key blob form — probe-confirmed; must be first) →
  runs the migration check (step 4) → `drizzle(expoDb, { schema })` → assigns the
  module singletons. `initDb()` must be safe to call more than once (no-op if
  already initialized).
- `db` / `expoDb` exports: repositories currently `import { db }` and query
  inside functions. Keep that ergonomics but make premature access fail LOUDLY,
  not with a confusing `undefined`. Either export live-binding `let db`/`expoDb`
  assigned by `initDb`, guarded by an accessor that throws
  `"DB accessed before initDb()"`, or expose `getDb()`/`getExpoDb()` and switch
  call sites. Implementer's choice, but premature-access MUST throw a clear
  diagnostic. No query may run before `initDb()` resolves.
- **`PRAGMA key` must precede any query, including `migrate()`.**

### 4. One-time plaintext → encrypted migration (data-loss-critical)

Inside `initDb`, after opening + `PRAGMA key`, determine DB state and migrate if
needed. **Verify-before-delete; never destroy the plaintext until the encrypted
copy is proven good.**

- **Detect:** run `expoDb.getFirstSync('SELECT count(*) FROM sqlite_master')`
  after `PRAGMA key`.
  - Succeeds → already encrypted (or a fresh empty DB) → done, proceed to
    `migrate()`.
  - Throws (SQLCipher can't read a plaintext file with a key → "file is not a
    database"/"prepareSync has failed") → the file is a legacy **plaintext** DB.
    Migrate it.
- **Migrate** (probe-confirmed sequence): close the keyed handle. Open the
  plaintext file (no key). On that handle:
  `ATTACH DATABASE '<docdir>/projectxavier.enc.db' AS enc KEY "x'<hex>'";
  SELECT sqlcipher_export('enc'); DETACH DATABASE enc;`
  Then: (a) open `projectxavier.enc.db` with the key and assert a probe query +
  that row counts of a couple of tables match the plaintext original; (b) only
  then atomically replace: `expo-file-system` delete `projectxavier.db`, move
  `projectxavier.enc.db` → `projectxavier.db`; (c) reopen `projectxavier.db`
  with the key and `PRAGMA key`.
- **Crash-safety:** if `projectxavier.enc.db` exists at launch but
  `projectxavier.db` is still plaintext (interrupted before the swap), delete the
  stale partial `.enc.db` and restart the migration from the intact plaintext
  source. The plaintext DB is the source of truth until the verified swap. A
  half-written `.enc.db` is always safe to discard.
- **Fresh install:** no plaintext file exists → open with key, `migrate()`
  creates tables in the encrypted DB from the start. No migration branch.

### 5. Bootstrap wiring (`app/_layout.tsx`)

In the startup effect (currently `await migrate()` first), insert
`await initDb()` as the **first** awaited call, before `migrate()`. `migrate()`
and everything downstream then run against the keyed handle. Keep the existing
`startupError` splash path so a failed `initDb`/migration surfaces a message
instead of a blank/stuck screen (do NOT silently swallow — a migration failure
must be visible, and must NOT have deleted the plaintext source).

### 6. Honest copy (in scope for DB-only)

- Fix the stale `src/db/client.ts` header comment ("encrypted backups/sync
  layered on top" — false; backups are plaintext JSON, that's M3).
- Update `CLAUDE.md` guardrail #5 wording if it overclaims at-rest encryption
  scope (DB now encrypted; backups still user-controlled plaintext files).
- Note for the store step (not code): App Privacy answers must state the DB is
  encrypted at rest and that user-created backups are plaintext files in their
  own iCloud/Files. (Out of scope to change here; flag it.)

## What stays unchanged (verify, don't touch)

- **Backups/restore work transparently** through the keyed handle: `gatherBackupData`
  reads via Drizzle (decrypts in memory), `applyBackup`'s `withTransactionAsync`
  runs on the keyed handle. The serialized JSON is still plaintext (M3, deferred).
  Confirm the H1 backup mutex still wraps correctly.
- **Widget** reads a separate App Group JSON summary, not the DB — unaffected.
- **Domain layer** (framework-free) never imports `client.ts`, so the plain-Node
  BDD suite is unaffected by the async refactor.

## Acceptance criteria

Because SQLCipher is native, the plain-Node suite **cannot** exercise encryption.
Verification is layered:

1. **Node suite unaffected:** `npm run typecheck && npm run lint && npm test`
   green in the worktree (416 tests). Any new pure/testable helper (e.g. the
   migration-state decision, if factored to take an injected "probe query
   result") gets a unit test; the native glue does not.
2. **Simulator smoke test of the REAL code** (the honest gate for this ship —
   reuse the probe harness approach): a sim build launches, and with (a) a fresh
   install the DB is created encrypted, (b) a **seeded legacy plaintext**
   `projectxavier.db` present, `initDb` migrates it, the app reads its data, and
   the on-disk file is afterward unreadable without the key. Capture via a
   temporary launch log. This proves the actual `client.ts`/migration code, not
   just the probe's throwaway harness.
3. **Device confirm** (build 31): existing soak data survives the upgrade
   (migration), app unlocks and shows transactions, add/edit/backup/restore all
   still work. User also spot-confirms the Keychain write succeeds on the signed
   build (the probe's step-A failure was an unsigned-build artifact).

## Constraints

- Never delete/overwrite the plaintext DB until the encrypted copy is verified
  (row counts + probe query). Migration is idempotent and crash-safe.
- `PRAGMA key = "x'<64hex>'"` raw-key form, first statement, every open.
- `src/domain/**` stays framework-free; encryption glue lives under `src/db/`.
- Prebuild + pod install required once (flag toggle); re-apply manual-signing
  patch before archiving (release-manager, /build).
- Key accessibility: `AFTER_FIRST_UNLOCK` (survives device migration, not
  extractable from a casual backup — user's choice).

## Edge cases

- **Interrupted migration** (crash mid-export or mid-swap): stale `.enc.db`
  discarded, retried from intact plaintext next launch. No data loss.
- **Key missing but DB encrypted** (Keychain cleared, e.g. restore-to-new-device
  where `AFTER_FIRST_UNLOCK` key didn't come across, or user wiped Keychain):
  the DB can't be decrypted. Detect and surface a clear error state rather than
  crashing or silently creating a new empty DB over the encrypted one. (With
  `AFTER_FIRST_UNLOCK` on an encrypted device backup this shouldn't happen, but
  handle it — do NOT clobber the encrypted file.)
- **`enableChangeListener`** must still work on the keyed handle (it did in the
  probe implicitly; confirm no regression in widget/live updates).
- **Already-encrypted returning user:** detection short-circuits, no migration,
  normal launch.
