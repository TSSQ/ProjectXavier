import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A callback whose identity never changes but which always runs the latest
 * `fn` — for handing a screen's per-render handlers to a memoised child
 * without breaking the memo (issue #27, the Assistant composer). Only for
 * event handlers: calling it during render would see the previous `fn`.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
