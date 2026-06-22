# Security model

Maps the project's non-negotiables to concrete mechanisms.

| # | Requirement | How it's met |
| --- | --- | --- |
| 1 | Data persistence + backup/restore | On-device SQLite is the source of truth. `src/lib/backup.ts` produces an **encrypted** envelope (AES-256-GCM) for export to iCloud/Files and optional cloud sync. Round-trip covered by `backup-restore.feature`. |
| 2 | Authentication | Sign in with Apple / Google / email (magic link). JWT sessions; tokens stored in the device keychain via `expo-secure-store`. **Biometric (Face ID) app-lock** on launch (`src/lib/secureStore.ts`, gated in `app/_layout.tsx`). |
| 3 | DDoS / abuse protection | Cloudflare WAF + DDoS protection in front of all endpoints; per-IP and per-user rate limiting at the AI proxy; monthly AI-parse quotas. |
| 4 | SQL injection | **Only parameterised statements** — Drizzle ORM + `src/db/sql.ts` bind every value as `?`. Never string-concatenated. Proven by `input-safety.feature`. |
| 5 | No PII | Store only auth-provider id + email. Financial data is **end-to-end encrypted** on-device, so the server stores opaque ciphertext only. |

## Additional hardening

- **Untrusted AI/OCR output** is validated against a zod schema before use
  (`aiParsedExpenseSchema`); never executed.
- **Local database at rest:** encrypting the on-device SQLite with SQLCipher
  (AES-256, key in Secure Enclave, biometric-gated) is the accepted approach —
  see [ADR 0001](adr/0001-sqlcipher-local-db-encryption.md). Not yet implemented;
  today at-rest relies on OS device encryption + the biometric app-lock.
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
