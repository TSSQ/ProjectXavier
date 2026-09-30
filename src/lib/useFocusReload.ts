import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { createReloadGate, ReloadGate } from '../domain/reloadGate';
import { getReloadKey } from '../features/settings/repository';

/**
 * Run `refresh` when the screen gains focus — but only if something it shows
 * has changed since its last load (src/domain/reloadGate.ts, issue #27).
 * Calls to `refresh` from the screen itself (after its own writes) are not
 * gated. A load that fails forgets the key, so the next focus retries it.
 *
 * Rethrowing here would leave a failing refresh() (or a rejecting
 * getReloadKey()/shouldReload()) as an unhandled promise rejection — this is
 * a fire-and-forget effect body, nothing is awaiting it. Warn and let the
 * next focus retry instead.
 */
export function useFocusReload(refresh: () => Promise<unknown>): void {
  const gateRef = useRef<ReloadGate | null>(null);
  if (!gateRef.current) gateRef.current = createReloadGate(getReloadKey);
  useFocusEffect(
    useCallback(() => {
      const gate = gateRef.current!;
      void (async () => {
        let shouldReload: boolean;
        try {
          shouldReload = await gate.shouldReload();
        } catch (e) {
          console.warn('useFocusReload: shouldReload failed', e);
          return;
        }
        if (!shouldReload) return;
        try {
          await refresh();
        } catch (e) {
          gate.invalidate();
          console.warn('useFocusReload: refresh failed', e);
        }
      })();
    }, [refresh])
  );
}
