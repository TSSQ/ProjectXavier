/**
 * AI parse proxy (Supabase Edge Function, Deno).
 *
 * The app NEVER holds the model API key — it calls this function, which holds
 * the key, authenticates the caller, and asks Claude to turn an expense
 * description (or on-device OCR text) into structured JSON. The response is
 * shaped by a JSON schema and re-validated by the app against
 * `aiParsedExpenseSchema` before it's trusted (defence in depth).
 *
 * Model tiering (cost lever): parse first with a cheap model (Haiku); if it
 * reports low confidence, escalate the same input to a stronger model (Sonnet
 * at low effort) and return that result instead.
 *
 * Deploy:  supabase functions deploy parse
 * Secrets: supabase secrets set ANTHROPIC_API_KEY=...   (never in the repo)
 * Front with Cloudflare WAF + rate limiting; enforce per-user AI quotas here.
 */
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

// Cheap first pass. Haiku 4.5 does NOT accept the `effort` parameter.
const DEFAULT_MODEL = Deno.env.get('AI_MODEL') ?? 'claude-haiku-4-5';
// Escalation for low-confidence parses; runs at low effort to stay cheap/fast.
const ESCALATION_MODEL = Deno.env.get('AI_ESCALATION_MODEL') ?? 'claude-sonnet-4-6';
// Below this confidence, re-run the parse on the escalation model.
const CONFIDENCE_THRESHOLD = Number(
  Deno.env.get('AI_CONFIDENCE_THRESHOLD') ?? '0.5'
);

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

/**
 * JSON schema the model must fill. Mirrors aiParsedExpenseSchema in the app.
 * Note: structured outputs don't support numeric/length constraints, so ranges
 * (amount > 0, confidence 0..1) are enforced by the app's zod schema, not here.
 */
const EXPENSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    amount: {
      type: ['integer', 'null'],
      description: 'Amount in minor units (cents). null if unknown.',
    },
    currency: {
      type: ['string', 'null'],
      description: 'ISO 4217 code, e.g. "USD". null if unknown.',
    },
    type: { type: ['string', 'null'], enum: ['expense', 'income', 'transfer', null] },
    category: { type: ['string', 'null'] },
    payee: { type: ['string', 'null'] },
    note: { type: ['string', 'null'] },
    occurredAt: {
      type: ['integer', 'null'],
      description: 'Epoch milliseconds the transaction occurred. null if unknown.',
    },
    confidence: { type: 'number', description: '0..1 self-rated parse confidence.' },
  },
  required: [
    'amount',
    'currency',
    'type',
    'category',
    'payee',
    'note',
    'occurredAt',
    'confidence',
  ],
} as const;

const SYSTEM = [
  'You convert a short expense description (typed or OCR’d from a receipt)',
  'into structured data. Return amounts in MINOR units (cents): $12.50 -> 1250.',
  'Infer the transaction type. Use null for any field you cannot determine with',
  'reasonable confidence rather than guessing. Set "confidence" to your overall',
  'confidence in the parse from 0 to 1.',
].join(' ');

/** Run one parse pass. `effort` is only valid on models that support it. */
async function runParse(
  model: string,
  content: string,
  effort?: 'low' | 'medium' | 'high'
): Promise<string | null> {
  const format = { type: 'json_schema', schema: EXPENSE_SCHEMA };
  const message = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM,
    output_config: effort ? { effort, format } : { format },
    messages: [{ role: 'user', content }],
  });
  const out = message.content.find((b: { type: string }) => b.type === 'text');
  return out && out.type === 'text' ? out.text : null;
}

function confidenceOf(jsonText: string): number {
  try {
    const v = JSON.parse(jsonText)?.confidence;
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // Authenticate: the caller must present a valid Supabase JWT.
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized' }, 401);
  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData.user) return json({ error: 'unauthorized' }, 401);

  // TODO: enforce per-user monthly AI-parse quota + per-IP rate limit here
  // (also the free/premium monetization lever). Cloudflare handles edge DDoS.

  let body: { text?: string; defaultCurrency?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const text = (body.text ?? '').trim();
  if (!text) return json({ error: 'missing_text' }, 400);

  const now = new Date().toISOString();
  const content =
    `Current date: ${now}. ` +
    (body.defaultCurrency ? `Default currency: ${body.defaultCurrency}. ` : '') +
    `Expense: ${text}`;

  // Cheap first pass.
  const cheap = await runParse(DEFAULT_MODEL, content);
  if (!cheap) return json({ error: 'no_output' }, 502);

  // Escalate to the stronger model (low effort) only when confidence is low.
  let result = cheap;
  if (confidenceOf(cheap) < CONFIDENCE_THRESHOLD) {
    const escalated = await runParse(ESCALATION_MODEL, content, 'low');
    if (escalated) result = escalated;
  }

  // Return the model's JSON straight through; the app validates it with zod.
  return new Response(result, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
