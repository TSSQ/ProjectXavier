/**
 * Shared cold-start retry policy for an on-device Apple Foundation Models
 * call (review B1/S1 — was previously hand-mirrored in TWO places:
 * `src/features/ai/deviceParse.ts`'s `deviceParse()` loop, and a
 * `FM_MAX_ATTEMPTS` copy in `evals/engines/run_node.mjs`'s `runFM`. Both now
 * call THIS module, so the eval harness's retry behaviour can never silently
 * drift from the app's).
 *
 * The binding creates a fresh `LanguageModelSession` per call with no
 * prewarm, so the first structured-output call per process often runs cold
 * and drops fields (notably the amount); a second, now-warm attempt usually
 * recovers a usable parse. `hasAmountEvidence` gates the retry: text naming
 * no amount at all can only have a retry hallucinate one (issue #27).
 *
 * Framework-free: `attempt` is injected, so this has zero RN/native imports
 * and stays testable in the plain-node BDD suite (unlike `deviceParse.ts`,
 * which is a TurboModule caller and can't be imported there).
 */
import { hasAmountEvidence, isUsefulDeviceParse } from './deviceParsePrompt';

/** How many times a single on-device call is attempted for one text, when
 *  the text has amount evidence (see `hasAmountEvidence`) — otherwise only
 *  one attempt is made, since a retry on amount-less text could only invent
 *  an amount, never recover one. */
export const DEVICE_PARSE_MAX_ATTEMPTS = 2;

export interface DeviceParseAttemptsResult<Parse> {
  /** The first USEFUL parse seen, else the last non-null (but weak) parse
   *  seen, else `null` when every attempt either threw or returned `null`. */
  parse: Parse | null;
  /** How many attempts were made (1 or `DEVICE_PARSE_MAX_ATTEMPTS`, capped by
   *  `hasAmountEvidence`). */
  attempts: number;
  /** How many of those attempts threw (a generation/binding failure — caught
   *  and counted as a failed attempt, never rethrown). */
  threw: number;
}

/**
 * Run `attempt` (one on-device `generateObject` call, already normalized to
 * the caller's `Parse` shape) up to `DEVICE_PARSE_MAX_ATTEMPTS` times for
 * `text`, retrying only while the result isn't useful yet
 * (`isUsefulDeviceParse`) and only when `text` has amount evidence.
 *
 * Returns the first useful parse as soon as one appears (no further
 * attempts); otherwise the last non-throwing (but weak/null) parse seen;
 * otherwise `null`. A throwing attempt is caught here — never rethrown —
 * and counts as a failed attempt (`threw` increments, `last` is unchanged).
 *
 * `attempt` receives `(attemptNo, maxAttempts)` (1-based, `maxAttempts`
 * already resolved from `hasAmountEvidence`) — review N6 — so a caller that
 * wants to log/report attempt progress (`deviceParse.ts`'s
 * `console.warn`) doesn't need to re-derive the same cap independently; the
 * one place that actually decides it (this function) is the one source of
 * truth for it.
 *
 * Both `deviceParse.ts` (the app) and `runFM` (the eval harness's on-device
 * probe runner) call this directly so their retry behaviour can never
 * diverge; `deviceParse()` itself still returns just the `parse`, so this
 * change is behaviour-preserving for the app.
 *
 * `isFinal` (optional) marks a parse that is the model's settled answer even
 * though it is not useful: the FM contract's `isTransaction: false` (step 3) is
 * a deliberate refusal, not a cold-start dropped field, so retrying it can only
 * cost a second generation (or flip a refusal into an expense). Such a parse
 * ends the loop at once. Without `isFinal`, `amount: 0` (normalized to null)
 * cannot be told from a dropped field and is retried.
 */
export async function runDeviceParseAttempts<Parse extends { amount: number | null }>(
  text: string,
  attempt: (attemptNo: number, maxAttempts: number) => Promise<Parse | null>,
  isFinal?: (parse: Parse) => boolean
): Promise<DeviceParseAttemptsResult<Parse>> {
  // No amount in the words -> a retry could only invent one (issue #27).
  const maxAttempts = hasAmountEvidence(text) ? DEVICE_PARSE_MAX_ATTEMPTS : 1;
  let last: Parse | null = null;
  let threw = 0;
  let attemptsMade = 0;

  for (let i = 1; i <= maxAttempts; i++) {
    attemptsMade = i;
    try {
      const parsed = await attempt(i, maxAttempts);
      if (isUsefulDeviceParse(parsed) || (parsed != null && isFinal?.(parsed))) {
        return { parse: parsed, attempts: attemptsMade, threw };
      }
      last = parsed ?? last;
    } catch {
      threw += 1;
    }
  }
  return { parse: last, attempts: attemptsMade, threw };
}
