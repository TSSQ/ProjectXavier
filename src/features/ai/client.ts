/**
 * Client for the AI parsing proxy.
 *
 * The app NEVER holds the model API key. It calls our backend proxy (which
 * holds the key, enforces auth, rate limits, caches, and tiers models). For
 * receipts, on-device OCR text is sent — not the image — to keep cost minimal.
 * The proxy's response is validated against a schema before the app trusts it.
 */
import { aiParsedExpenseSchema, AiParsedExpense } from '../../lib/validation';

const PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL ?? '';

/**
 * Thrown when the proxy rate-limits us (429) — either the per-IP flood guard or
 * the per-user daily AI quota. `retryAfterSeconds` comes from the Retry-After
 * header so the UI can tell the user when to try again.
 */
export class RateLimitedError extends Error {
  constructor(
    readonly kind: 'rate_limited' | 'quota_exceeded' | 'unknown',
    readonly retryAfterSeconds: number
  ) {
    super(
      kind === 'quota_exceeded'
        ? "You've reached today's AI parsing limit. It resets tomorrow."
        : 'Too many requests right now — please try again in a moment.'
    );
    this.name = 'RateLimitedError';
  }
}

export interface ParseRequest {
  /** Natural-language description, or OCR text extracted on-device. */
  text: string;
  /** Optional locale/currency hints to improve parsing. */
  defaultCurrency?: string;
  /**
   * Grounding context so the model maps to the user's existing entities instead
   * of inventing duplicates. Bounded lists (categories, accounts) are sent in
   * full; payees are capped by the caller to control prompt cost.
   */
  categories?: string[];
  payees?: string[];
  accounts?: string[];
  /** Device time (ms since epoch) — passed to the proxy so the prompt uses the
   *  user's local "now" rather than the server's clock. */
  now?: number;
}

export async function parseExpense(
  req: ParseRequest,
  authToken: string
): Promise<AiParsedExpense> {
  if (!PROXY_URL) {
    throw new Error('AI proxy URL not set (EXPO_PUBLIC_AI_PROXY_URL).');
  }

  let res: Response;
  try {
    res = await fetch(`${PROXY_URL}/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(req),
    });
  } catch (e) {
    throw new Error(
      `Network error reaching AI proxy: ${(e as Error).message}`
    );
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After')) || 0;
    let kind: 'rate_limited' | 'quota_exceeded' | 'unknown' = 'unknown';
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error === 'quota_exceeded' || err.error === 'rate_limited') {
        kind = err.error;
      }
    } catch {
      /* fall back to 'unknown' */
    }
    throw new RateLimitedError(kind, retryAfter);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI proxy ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  // Treat the model output as untrusted: validate before use.
  return aiParsedExpenseSchema.parse(json);
}
