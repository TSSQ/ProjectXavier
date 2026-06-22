# ADR 0002 — Use plain SQLite for the local database (defer at-rest DB encryption)

- **Status:** Accepted (supersedes [ADR 0001](0001-sqlcipher-local-db-encryption.md))
- **Date:** 2026-06-22
- **Deciders:** ProjectXavier team
- **Related:** guardrails #1 (local SQLite is the source of truth; backup/restore
  must round-trip) and #5 (financial data is end-to-end encrypted);
  `docs/SECURITY.md`; `src/db/client.ts`, `src/lib/backup.ts`.

## Context

ADR 0001 proposed encrypting the local database file at rest with SQLCipher.
On reflection the cost/benefit didn't justify it for where the product is now:
SQLCipher requires swapping the driver to `op-sqlite`, a custom native build (no
Expo Go), and — most significantly — a device-bound key whose loss permanently
bricks the local DB, which made an off-device passphrase backup *mandatory* and
broke "free" recovery from OS device backups.

We are keeping things simple and shipping on stock `expo-sqlite`.

## Decision

Use **plain SQLite** (`expo-sqlite`, already in place) for the on-device
database. At-rest confidentiality relies on:

1. **OS full-disk / file encryption** (iOS Data Protection, Android FBE),
2. the **app sandbox**, and
3. the **biometric app-lock** gating access before any financial data renders
   (guardrail #2).

**Backups and any future cloud sync remain end-to-end encrypted** via
`src/lib/backup.ts` (AES-256-GCM, passphrase/recovery-key derived). Only the
*live local DB file* is unencrypted-by-us.

No new dependency, no driver swap, no custom build needed for encryption.

## Consequences / tradeoffs

**Positive**
- Simplest possible stack; `expo-sqlite` stays, no `op-sqlite`/SQLCipher, no
  custom-build requirement for encryption, easier debugging, no perf overhead.
- **No key-loss-bricks-the-DB problem.** Because the DB isn't bound to a device
  key, an **OS device backup (iCloud/Google) can recover it normally** — the
  free, zero-effort recovery path is back on the table (see ADR-adjacent backup
  discussion). The app's passphrase backup becomes a *nice-to-have* for
  cross-platform/portable recovery rather than the *only* lifeline.
- The passphrase/recovery-key UX is no longer mandatory at any point; users can
  rely on OS backup and only opt into our encrypted export if they want a
  portable, cross-ecosystem copy.

**Negative / accepted risk**
- The DB file is **plaintext on disk**. On a **jailbroken/rooted device**, or via
  **forensic extraction of an unlocked/decrypted device**, or inside an
  **unencrypted OS backup**, the financial data is readable. OS device encryption
  + the biometric gate are the only at-rest protections.
- This **does not meet a strict "end-to-end encrypted at rest" reading of
  guardrail #5.** Guardrail #5 is therefore scoped to mean: *no PII beyond
  email + auth-provider id; backups and sync are E2E-encrypted; the live local DB
  relies on OS device encryption + the biometric lock.* `docs/SECURITY.md` is
  updated to state this plainly rather than overclaim.

## Revisit criteria

Reconsider SQLCipher (per ADR 0001, which documents the full approach) if any of:
- we add features that materially raise the value of an extracted DB file,
- enterprise/compliance requirements demand encrypted-at-rest storage, or
- a credible threat model includes device-level forensic extraction.

## Implementation impact

None — the code already uses `expo-sqlite`. This ADR only removes the SQLCipher
plan and corrects the security documentation.
