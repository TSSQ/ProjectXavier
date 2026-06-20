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

### Implementation: `supabase/functions/parse`

The Phase-2 implementation lives in [`supabase/functions/parse/index.ts`](supabase/functions/parse/index.ts).
It verifies the Supabase JWT, calls Claude with a JSON-schema-constrained
response (so output matches `aiParsedExpense`), and returns the raw JSON — which
the **app re-validates with zod** before trusting it (defence in depth).

**Model tiering (cost lever):** the cheap model (Haiku) handles the first pass;
if it reports confidence below the threshold, the same input is re-parsed by the
stronger model (Sonnet, at `low` effort) and that result is returned. Haiku 4.5
does not accept the `effort` parameter, so it's sent only on the Sonnet pass.

```bash
# One-time: log in and link your project
supabase login && supabase link --project-ref <ref>

# Secrets (never committed):
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform.

# Optional tiering overrides (defaults shown):
supabase secrets set AI_MODEL=claude-haiku-4-5            # cheap first pass
supabase secrets set AI_ESCALATION_MODEL=claude-sonnet-4-6 # low-confidence escalation
supabase secrets set AI_CONFIDENCE_THRESHOLD=0.5

supabase functions deploy parse
```

Point the app at it via `EXPO_PUBLIC_AI_PROXY_URL` (see `.env.example`); the app
calls `${EXPO_PUBLIC_AI_PROXY_URL}/parse`.

> **On-device OCR** is an injectable boundary (`src/features/ocr/recognizer.ts`).
> Wire a native text-recognition module (e.g. `@react-native-ml-kit/text-recognition`)
> in a dev build; the assistant flow consumes the `TextRecognizer` interface, so
> no other code changes when OCR is added.

## 2. Sync + auth (Supabase)

- **Auth:** Sign in with Apple / Google / email.
- **Sync store:** end-to-end **encrypted blobs** + minimal metadata. The server
  cannot read financial data.
- **Row-Level Security:** every row is scoped to its owner.

Cloudflare (WAF + DDoS protection + rate limiting) fronts all endpoints.

> Nothing here stores plaintext financial data or PII beyond an email +
> auth-provider id. See `../docs/SECURITY.md`.
