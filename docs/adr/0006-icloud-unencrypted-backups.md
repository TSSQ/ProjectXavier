# ADR 0006 — Store iCloud backups unencrypted (defer app-level E2E for backups)

- **Status:** Accepted
- **Date:** 2026-06-28
- **Deciders:** ProjectXavier team
- **Related:** guardrail #5 (financial data E2E-encrypted before leaving the device);
  [ADR 0002](0002-plain-sqlite-at-rest.md) (plain SQLite at rest);
  `docs/SECURITY.md`; `src/lib/backup.ts`; `src/features/backup/`.

## Context

The original `src/lib/backup.ts` (v1) encrypted each backup with AES-256-GCM
and a user-supplied passphrase. This satisfied guardrail #5 ("E2E-encrypted
before leaving the device") but introduced significant UX friction:

- The user must create and securely store a passphrase at backup time.
- Losing the passphrase permanently destroys the backup value (no key escrow).
- A forgotten or mis-typed passphrase triggers a confusing failure on restore —
  the error is indistinguishable from a corrupt file.
- Passphrase management is orthogonal to what users actually want: "tap backup,
  tap restore, done."

iCloud provides end-to-end encryption for iCloud Drive data (Advanced Data
Protection) at the OS/platform level. For the majority of users on recent iOS
versions with ADP enabled, our backups are E2E-encrypted at the OS level
without any app-level key management.

## Decision

**Store iCloud backups as plaintext JSON** — no app-level passphrase, no
AES-256-GCM wrapper. At-rest confidentiality relies on:

1. **Apple's iCloud encryption** (standard iCloud Drive encryption; E2E with
   Advanced Data Protection for users who have it enabled),
2. the **user's device lock** (Face ID / Touch ID) which gates access to the
   app and to iCloud content on-device, and
3. the **app sandbox** (other apps cannot read the app's iCloud container).

**Guardrail #5's "E2E-encrypted before leaving the device" requirement is
explicitly deferred for backups.** The live local DB already relies on OS
encryption (per ADR 0002). Backups follow the same model.

The backup format is bumped to **version 2** to mark the plaintext transition.
Version-1 encrypted blobs are no longer readable by the app (no migration
path — users with v1 blobs will need to create a new backup after upgrading).

## Consequences / tradeoffs

**Positive**

- Zero passphrase UX: backup and restore are one-tap operations.
- No "I forgot my passphrase" support burden.
- Backup files are human-readable JSON — easier to debug; can be inspected if
  needed by the user.
- Removes `src/lib/crypto.ts` and the `CryptoProvider` abstraction entirely —
  less code to maintain and audit.

**Negative / accepted risk**

- A backup file extracted from iCloud (e.g. via a compromised iCloud account,
  a law-enforcement data request, or an iCloud account recovery by Apple) is
  readable without any passphrase. This is the same risk as an unencrypted
  OS device backup.
- Users who have not enabled iCloud Advanced Data Protection have weaker
  at-rest guarantees than the original AES-256-GCM scheme.
- This **supersedes the backup half of guardrail #5.** The guardrail is not
  deleted — future server sync would need to re-enable E2E encryption.

## Revisit criteria

Reconsider app-level encryption of backups if any of:

- we add server-side backup sync (guardrail #5 must fully apply there),
- enterprise/compliance customers require encrypted-at-rest exports,
- a credible threat model shows iCloud account compromise is a realistic
  attack vector for our user population, or
- Apple weakens the iCloud E2E guarantees (e.g. removes ADP).

In that case, re-introduce `src/lib/crypto.ts` and a passphrase / recovery-key
flow, or integrate with iCloud Keychain for key storage.

## Update (2026-07-13) — format bumped to v3: plaintext SQLite

Assessment M3 replaced the per-row JSON serialiser (`gatherBackupData` +
`serializeBackup`) with a **whole-database plaintext SQLite image**, produced
from the live (SQLCipher-keyed) connection via `sqlcipher_export` with an
empty attach key (`KEY ''`) — see `src/features/backup/sqliteFile.ts`. This
is a **format change only; the confidentiality decision above is unchanged**:
backups remain plaintext, for the same reasons (one-tap restore, no
passphrase/key-escrow burden, portable to a brand-new device). The two are
independent:

- **Live local DB:** SQLCipher-encrypted at rest (see
  [ADR 0001](0001-sqlcipher-local-db-encryption.md) and the H4 build).
- **Backups:** plaintext — a `.sqlite` file (v3) or, for any backup made
  before this change, a `.json` file (v2, restore-only) — stored unencrypted
  in the user's own iCloud Documents container, protected by Apple's iCloud
  encryption and the user's device lock, exactly as decided above.

Why a whole-DB image instead of a better JSON serialiser: a per-row
serialiser (`gatherBackupData`) has to enumerate every field by hand, so a
newly added column can silently be left out of every future backup with no
error at either backup or restore time. A full SQLite image copies every
column that exists in the live schema at export time — a newer/added column
just comes along for the ride, no code change required.

Restore attaches the downloaded `.sqlite` file to the live connection, but
does **not** copy tables with a raw `INSERT ... SELECT *` — an early version
of this change did, and QA reproduced exactly why that's unsafe: SQLite has
no strict column typing, so a hand-edited `.sqlite` (a real trust boundary —
it's a user-editable file in the Files app, guardrail #6) with e.g.
`amount = 'NOT_A_NUMBER'` inserted and **committed with no error**; and a
positional copy fails outright on a backup with fewer columns than the live
schema (an old backup restored after a migration added columns). Instead,
every row is read into JS, mapped from snake_case/0-1-booleans to the domain
shape, and validated through the same zod schemas every other write path
already uses (`src/domain/sqliteBackupRows.ts`) — a single invalid row aborts
the whole restore before anything is wiped. The validated result is handed to
the EXISTING `applyBackupUnlocked`, the same wipe-and-reinsert-by-named-column
function the `.json` path already uses via `applyBackup` — same crash-safety/
rollback profile as before, and named-column inserts are what let an
older-schema backup restore cleanly (missing columns just take the same
default a fresh row would get).

`parse_metrics` (content-free parse diagnostics) is deliberately dropped from
the exported `.sqlite` snapshot right after `sqlcipher_export` runs — it was
already excluded from the legacy JSON backup, and restore only ever reads the
6 domain tables regardless, so leaving it in the image served no purpose; see
`docs/design/sqlite-backup-format-spec.md`'s edge cases for the full reasoning.

The fictional "v1 AES-256-GCM encrypted" restore path (referenced in this
ADR's Context/Decision sections above as history) never had a working
decrypt branch in code and its round-trip test fed it a plaintext payload
that could never have existed for a real encrypted file — both the dead
branch and the misleading test have been removed
(`src/lib/backup.ts`/`tests/__steps__/backup-restore.steps.ts`). This does
not change any decision in this ADR; it only corrects code and tests to
match it.

See `docs/design/sqlite-backup-format-spec.md` for the full spec.
