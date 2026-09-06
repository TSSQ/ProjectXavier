/**
 * Once-per-token guard for query-param deep links (glass-chrome-adoption-spec
 * §4 D3.2). expo-router keeps a tab's query params around across tab switches,
 * so a handler keyed on "the param is present" re-fires every time the tab
 * regains focus — clearing the param is not a reliable guard on its own. The
 * sender attaches a fresh token per tap (`?add=<Date.now()>`) and the receiver
 * remembers the last token it acted on:
 *
 *   - a new token  → handle once, remember it
 *   - the same token again (tab away and back, re-render) → ignore
 *   - no token → ignore, keep the memory (so a later identical stale value
 *     is still ignored)
 *
 * Pure so the BDD suite can pin the contract; the screen keeps `lastHandled`
 * in a ref.
 */
export function takeDeepLinkToken(
  lastHandled: string | null,
  token: string | undefined
): { handle: boolean; lastHandled: string | null } {
  if (!token) return { handle: false, lastHandled };
  if (token === lastHandled) return { handle: false, lastHandled };
  return { handle: true, lastHandled: token };
}
