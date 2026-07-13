# Security model

Maps the project's non-negotiables to concrete mechanisms.

| # | Requirement | How it's met |
| --- | --- | --- |
| 1 | Data persistence + backup/restore | On-device SQLite (SQLCipher-encrypted at rest) is the source of truth. `src/features/backup/sqliteFile.ts` produces a **whole-DB plaintext SQLite image** (`.sqlite`, via `sqlcipher_export`) stored in the app's iCloud Documents container — complete-by-construction, so a newly added column can't silently be missed. On restore, every row is read back, mapped, and validated through the existing zod schemas (`src/domain/sqliteBackupRows.ts`) **before any live table is touched** — a `.sqlite` file is user-editable (visible in Files), so this is a real trust boundary, not just a format detail (guardrail #6). Legacy `.json` backups (`src/lib/backup.ts`, pre-M3) still restore. Backups are **unencrypted by the app** — at-rest protection relies on Apple's iCloud encryption and the user's biometric device lock; this is independent of the live DB's own SQLCipher encryption. See [ADR 0006](adr/0006-icloud-unencrypted-backups.md). Round-trip covered by `backup-restore.feature`/`backup-format.feature`/`backup-sqlite-rows.feature`. |
| 2 | Authentication | Sign in with Apple / Google / email (magic link). JWT sessions; tokens stored in the device keychain via `expo-secure-store`. **Biometric (Face ID) app-lock** on launch (`src/lib/secureStore.ts`, gated in `app/_layout.tsx`). |
| 3 | DDoS / abuse protection | **Built:** at the AI proxy — `verify_jwt` at the gateway, per-IP rate limiting, a per-user daily quota (free tier = 5 parses/day), and a response cache, all enforced before the paid model call (`supabase/functions/parse`, policy in `_shared/guard.ts`, Upstash Redis REST store). Global Anthropic + Supabase spend caps are the hard backstop. **Planned (not yet built):** Cloudflare WAF + DDoS protection in front of all endpoints, and Turnstile on signup — see [follow-ups](HANDOFF.md#7-open-items--follow-ups). |
| 4 | SQL injection | **Only parameterised statements** — Drizzle ORM + `src/db/sql.ts` bind every value as `?`. Never string-concatenated. Proven by `input-safety.feature`. |
| 5 | No PII | Store only auth-provider id + email. Financial data in the live local DB relies on OS device encryption + the biometric lock (see [ADR 0002](adr/0002-plain-sqlite-at-rest.md)). **iCloud backups are stored unencrypted** (guardrail #5's "E2E-encrypted before leaving the device" requirement is deferred for backups — see [ADR 0006](adr/0006-icloud-unencrypted-backups.md)); future sync to the server would require re-enabling E2E encryption. |

## Additional hardening

- **Untrusted AI/OCR output** is validated against a zod schema before use
  (`aiParsedExpenseSchema`); never executed.
- **Local database at rest:** the on-device SQLite uses **plain `expo-sqlite`** —
  at-rest confidentiality relies on OS device encryption (iOS Data Protection /
  Android FBE), the app sandbox, and the biometric app-lock. DB-file encryption
  with SQLCipher was considered and **deferred** — see
  [ADR 0002](adr/0002-plain-sqlite-at-rest.md) (supersedes
  [ADR 0001](adr/0001-sqlcipher-local-db-encryption.md)).
- E2E keys held in Secure Enclave / Keychain; never leave the device in plaintext.
- Row-Level Security on the backend so a user can only access their own rows.
- TLS everywhere + certificate pinning in the app.
- Secrets via environment/secret manager; `.env` is gitignored, `.env.example`
  documents only client-safe values. **The LLM API key lives only on the proxy.**
- Optional jailbreak/root detection; minimal logging (no financial data);
  dependency scanning in CI.

## AI proxy (scaling + cost)

The app never holds the model key. It calls our proxy, which:
1. accepts **on-device OCR text** (not receipt images) to cut vision-token cost,
2. authenticates the user and enforces rate limits + quotas,
3. caches parses keyed on normalised input,
4. tiers models (cheap model first, escalate on low confidence),
5. validates and returns structured JSON.

Revisit on-device/self-hosted inference only when monthly spend would exceed the
cost of running our own GPU inference.
