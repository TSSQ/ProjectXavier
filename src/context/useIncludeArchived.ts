/**
 * Shared, session-scoped "Include archived accounts" toggle — read (and set)
 * by both the Dashboard and the Transactions tab, so archiving means one
 * thing on both screens (docs/design/account-archive-restore-spec.md
 * §5.3/§5.3a). "A per-screen useState would let the user hide on one screen
 * and not the other, which recreates the very inconsistency this fixes" — so
 * this lives in a single module-level store rather than two independent
 * `useState`s.
 *
 * A plain external store (subscribed to via `useSyncExternalStore`) rather
 * than a React context: the Dashboard and Transactions screens are sibling
 * tab routes, and a context provider would need to wrap the tab navigator
 * itself to be shared between them. This gets the same "one value, many
 * readers" result without any provider in the tree — importing the hook is
 * enough for a component to read and write the same shared value.
 *
 * Deliberately NOT persisted (§5.3's reasoning): the value lives only in this
 * module's in-memory variable, so it is always `false` again after a fresh
 * app launch/reload — the same session-local guarantee as
 * `src/domain/accountFilter.ts`'s account selection, so a cold launch always
 * matches the widget and Ask Xavier (both of which always exclude archived).
 */
import { useSyncExternalStore } from 'react';

let includeArchived = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return includeArchived;
}

function setIncludeArchived(next: boolean): void {
  if (next === includeArchived) return;
  includeArchived = next;
  listeners.forEach((listener) => listener());
}

/**
 * Reads the shared toggle and a setter to change it. Every component that
 * calls this hook re-renders whenever ANY consumer (on either screen)
 * changes the value — there is exactly one value, not one per caller.
 */
export function useIncludeArchived(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot);
  return [value, setIncludeArchived];
}
