# ADR 0001 — Encrypt the local database at rest with SQLCipher

- **Status:** Superseded by [ADR 0002](0002-plain-sqlite-at-rest.md) (2026-06-22) — we chose plain SQLite instead. This ADR is kept as a record of the option and the path to revisit if the threat model changes.
- **Date:** 2026-06-22
- **Deciders:** ProjectXavier team
- **Related:** guardrails #1 (local SQLite is the source of truth; backup/restore
  must round-trip) and #5 (financial data is end-to-end encrypted); `docs/SECURITY.md`;
  `src/lib/backup.ts`, `src/db/client.ts`.

## Context

The app stores a user's full spending history on-device in SQLite, which is the
source of truth. Today that database is **plaintext on disk**; at-rest
confidentiality relies on the OS sandbox, full-disk device encryption, and the
biometric app-lock. That is decent, but for data this sensitive (income,
balances, every transaction, spending habits) we want the database file itself
to be unreadable without a key the app controls — including inside OS device
backups (iCloud/Google), which otherwise capture the plaintext file.

End-to-end encryption already exists for **exported backups** (`src/lib/backup.ts`,
AES-256-GCM). This ADR is about the **live local database**.

## Decision

Encrypt the local database at rest using **SQLCipher** (AES-256, full-page
encryption). The encryption key is a device-random 256-bit key held in the
Secure Enclave / Keychain via `expo-secure-store`, released behind the existing
biometric gate. The key is **not** derived from the user's passphrase (that
would block every query on a prompt).

Because stock `expo-sqlite` does not expose SQLCipher, adopt
**`@op-engineering/op-sqlite`** (which supports SQLCipher and ships a Drizzle
driver) and build via the existing `expo-dev-client` / EAS pipeline.

## Options considered

1. **Stay plaintext, rely on device encryption + biometric gate.** Simplest, but
   the DB file is readable if extracted (e.g. from an unencrypted iCloud backup,
   a jailbroken device, or forensic tooling). Rejected for financial data.
2. **`expo-sqlite` + SQLCipher.** No first-class SQLCipher support; would require
   patching native builds. Rejected as brittle.
3. **`op-sqlite` + SQLCipher (chosen).** First-class SQLCipher flag, strong
   performance, official Drizzle driver, works with our dev-client. Cost: a
   driver swap and a custom native build.
4. **App-level field encryption (encrypt values, keep SQLite plaintext).** Breaks
   indexing/range queries on amounts/dates and complicates the domain layer.
   Rejected.

## Consequences / tradeoffs

**Positive**
- DB file is ciphertext at rest — unreadable without the Enclave key, including
  inside OS device backups (true E2E at rest, satisfying guardrail #5).
- Key lifecycle is tied to the biometric gate, reinforcing guardrail #2.
- Domain/repository/test layers are unaffected (the change is confined to the
  driver/open path).

**Negative / costs**
- **Performance:** per-page AES + one-time key derivation on open. For a small
  expense DB this is ~5–15% on queries and imperceptible in practice; tunable via
  KDF iterations and page size.
- **Build:** requires a custom native build (no Expo Go) and a new native
  dependency (`op-sqlite`), increasing binary size and build complexity. (Note:
  EAS builds are currently blocked by this workspace's network policy, so this
  must be built/verified outside the sandbox.)
- **Recoverability — the big one:** if the Enclave key is lost (app uninstalled,
  Keychain wiped, a device migration that drops the item), the local DB becomes
  **permanently undecryptable**. This makes the **off-device, passphrase-based
  encrypted backup mandatory**, not optional — it is the only recovery path that
  doesn't depend on the device key.
- **Debuggability:** the `.db` can't be opened with standard tools without the
  key; dev inspection needs the key passed in.
- **Scope:** protects data **at rest** only. Once unlocked, plaintext lives in
  RAM; SQLCipher does not defend a compromised device that already holds the key.

## Key model (two keys, two jobs)

- **Local DB key:** device-random 256-bit, generated on first launch, stored in
  Secure Enclave/Keychain (`expo-secure-store`), biometric-gated, never leaves
  the device. Used to open SQLCipher.
- **Backup key:** derived from a **user passphrase / recovery key** (existing
  `src/lib/backup.ts` KDF). Independent of the Enclave key so a brand-new device
  can restore a backup it never had the local key for.

## Implementation plan (when built)

1. Add `@op-engineering/op-sqlite` + config plugin enabling SQLCipher; create a
   dev/EAS build profile.
2. Add a `src/lib/dbKey.ts`: get-or-create the 256-bit key in `expo-secure-store`
   (with `requireAuthentication` / biometric where supported).
3. Rewrite **only** `src/db/client.ts` and the migrate runner to open the
   encrypted DB with the key (Drizzle op-sqlite driver). `schema.ts`,
   repositories, domain, and the BDD suite remain unchanged.
4. Migration: app is pre-release → ship a fresh encrypted DB (no plaintext→cipher
   `sqlcipher_export` needed). If we later need it for installed users, add an
   `sqlcipher_export` one-shot migration.
5. Update `docs/SECURITY.md` row #5 once shipped.

## Testing impact

None for the existing suite — tests run framework-free against the domain layer
and a `FakeDb`, which is driver-agnostic. Native encryption is verified manually
on a real build (Face ID gate → DB opens; wrong/absent key → DB fails to open).

## Open questions

- Confirm `op-sqlite` Drizzle driver parity with current `expo-sqlite` usage
  (transactions, `run`/`select`).
- Whether to expose a "rotate database key" action (re-key via `PRAGMA rekey`).
- KDF tuning (iteration count vs. cold-open latency) on lower-end devices.
