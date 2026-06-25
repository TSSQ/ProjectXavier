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

The Phase-2 implementation lives at the repo-root [`supabase/functions/parse/index.ts`](../supabase/functions/parse/index.ts)
— the location the Supabase CLI expects, so all `supabase` commands below run
from the **repo root**, not from `backend/`.
It verifies the Supabase JWT, calls Claude with a JSON-schema-constrained
response (so output matches `aiParsedExpense`), and returns the raw JSON — which
the **app re-validates with zod** before trusting it (defence in depth).

**Model tiering (cost lever):** the cheap model (Haiku) handles the first pass.
The same input is re-parsed by the stronger model (Sonnet, at `low` effort) when
the cheap parse is **low confidence, missing a required field (`amount`/`type`),
or unparseable**; otherwise the cheap result is returned. Haiku 4.5 does not
accept the `effort` parameter, so it's sent only on the Sonnet pass.

**Grounding:** the app passes the user's existing `categories`, `accounts`, and a
capped list of `payees` in the request body. The prompt instructs the model to
map to those existing entities (and pick the account by name when the user says
"paid with Amex") rather than inventing duplicates. The required-field set
mirrors `missingFields()` in `src/lib/validation.ts` — keep them in sync.

```bash
# One-time: log in and link your project
supabase login && supabase link --project-ref <ref>

# Secrets (never committed):
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# SUPABASE_URL + SUPABASE_ANON_KEY are auto-injected by the platform. The
# function verifies the caller's JWT with the low-privilege anon key and does
# NOT use the RLS-bypassing service-role key — nothing else to set.

# Optional tiering overrides (defaults shown):
supabase secrets set AI_MODEL=claude-haiku-4-5            # cheap first pass
supabase secrets set AI_ESCALATION_MODEL=claude-sonnet-4-6 # low-confidence escalation
supabase secrets set AI_CONFIDENCE_THRESHOLD=0.5

# Abuse/cost controls (Upstash Redis, REST API). REQUIRED in production —
# without them the function fails OPEN (no rate limit / quota):
supabase secrets set UPSTASH_REDIS_REST_URL=https://<db>.upstash.io
supabase secrets set UPSTASH_REDIS_REST_TOKEN=<token>
# Optional tuning (defaults shown):
supabase secrets set AI_DAILY_QUOTA=5           # free-tier parses per user per UTC day
supabase secrets set AI_RATE_LIMIT_PER_MIN=20   # requests per IP per minute
supabase secrets set AI_CACHE_TTL_SECONDS=86400 # response cache lifetime

supabase functions deploy parse
```

Point the app at it via `EXPO_PUBLIC_AI_PROXY_URL` (see `.env.example`); the app
calls `${EXPO_PUBLIC_AI_PROXY_URL}/parse`.

### Abuse & cost controls (the "denial-of-wallet" defence)

The proxy enforces three checks **before** the paid model call (pure logic in
[`supabase/functions/_shared/guard.ts`](../supabase/functions/_shared/guard.ts),
unit-tested in `tests/__features__/ai-guard.feature`; Upstash storage in
[`_shared/store.ts`](../supabase/functions/_shared/store.ts)):

1. **Per-IP rate limit** — coarse flood guard (default 20 req/IP/min).
2. **Response cache** — identical text + grounding context reuses a prior parse
   for free; a cache hit does **not** consume the user's quota (`X-Cache: HIT`).
3. **Per-user daily quota** — free-tier lever (default **5 parses/user/day**);
   beyond it the app falls back to manual transaction entry until the next day.

Over-limit requests get `429` with `Retry-After` + `X-RateLimit-*` headers; the
app surfaces them as `RateLimitedError` (see `src/features/ai/client.ts`).
`verify_jwt = true` is pinned for this function in `supabase/config.toml`, so
**anonymous** floods are rejected at the gateway, before any invocation cost.

> **Hard backstop — set these in the provider dashboards, they are the real
> denial-of-wallet ceiling and are NOT in code:**
> - **Anthropic Console → a monthly spend limit** on the API key.
> - **Supabase → Organization → Billing → spend cap** so usage can't bill past
>   a ceiling.
>
> In-function quota limits how often that ceiling is approached; a determined
> attacker creating many cheap (email-OTP) accounts can still exceed any
> *per-user* limit, so the global cap is what bounds total spend. Cloudflare WAF
> (item below) and **Turnstile on signup** (to stop bulk account creation) are
> the next layer once traffic warrants it.

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
