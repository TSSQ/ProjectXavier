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
