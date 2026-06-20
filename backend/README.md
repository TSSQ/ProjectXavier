# Backend (Phase 2–3)

Two responsibilities, both kept off the device:

## 1. AI proxy

A stateless serverless function (Supabase Edge Function or small Fastify
service) that holds the LLM API key and:

- authenticates the caller (JWT from Supabase Auth),
- enforces per-user + per-IP rate limits and monthly AI-parse quotas,
- caches parses keyed on normalised OCR/description text,
- tiers models (cheap first; escalate on low confidence),
- returns JSON validated against the app's `aiParsedExpense` schema.

Receipt images are OCR'd **on-device**; only the extracted text is sent here.

## 2. Sync + auth (Supabase)

- **Auth:** Sign in with Apple / Google / email.
- **Sync store:** end-to-end **encrypted blobs** + minimal metadata. The server
  cannot read financial data.
- **Row-Level Security:** every row is scoped to its owner.

Cloudflare (WAF + DDoS protection + rate limiting) fronts all endpoints.

> Nothing here stores plaintext financial data or PII beyond an email +
> auth-provider id. See `../docs/SECURITY.md`.
