/**
 * "Has anything this screen shows changed since it last loaded?" — so a tab
 * focus doesn't re-read the whole ledger through SQLCipher when nothing has
 * (issue #27: the Dashboard and Transactions tabs reloaded every account,
 * transaction, category, payee and series on every single focus).
 *
 * The key is the data revision — bumped by every account, transaction,
 * category, payee and series write, a restore and a currency relabel — plus
 * the currency setting, which changes without a bump. The key is taken
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

export function reloadKey(dataRevision: number, currency: string): string {
  return `${dataRevision}|${currency}`;
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
