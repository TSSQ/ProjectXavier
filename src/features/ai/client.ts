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

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI proxy ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  // Treat the model output as untrusted: validate before use.
  return aiParsedExpenseSchema.parse(json);
}
