/**
 * "Has anything this screen shows changed since it last loaded?" — so a tab
 * focus doesn't re-read the whole ledger through SQLCipher when nothing has
 * (issue #27: the Dashboard and Transactions tabs reloaded every account,
 * transaction, category, payee and series on every single focus).
 *
 * The key is the data revision — bumped by every account, transaction,
 * category, payee and series write, a restore and a currency relabel — plus
 * the currency setting, which changes without a bump, plus the local day:
 * what the screens derive from the clock (Today/Yesterday headers, the
 * Upcoming section and chips, the counted cutoff) goes stale at midnight
 * with no write at all, and a reload hands every memo and memoised row new
 * objects to recompute from. The key is taken
 * BEFORE the load it guards, so a write that lands during the load moves
 * the revision past it and the next focus reloads.
 *
 * Framework-free with an injected reader so the rule is testable in Node.
 */
export interface ReloadGate {
  /** True (and remembers the new key) when the key has changed since the
   *  last true — or on the very first call. */
  shouldReload(): Promise<boolean>;
  /** Forget the remembered key, so the next check reloads. */
  invalidate(): void;
}

/** `day` is the local start-of-day epoch (dates.ts startOfDay). */
export function reloadKey(dataRevision: number, currency: string, day: number): string {
  return `${dataRevision}|${currency}|${day}`;
}

export function createReloadGate(readKey: () => Promise<string>): ReloadGate {
  let seen: string | null = null;
  return {
    async shouldReload() {
      const key = await readKey();
      if (key === seen) return false;
      seen = key;
      return true;
    },
    invalidate() {
      seen = null;
    },
  };
}
