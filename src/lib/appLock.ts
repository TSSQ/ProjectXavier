import { createContext, useContext } from 'react';

/**
 * True while the app is locked behind the biometric cover (see lockView in
 * src/domain/biometricLock.ts). The app stays mounted under the cover, so
 * anything that draws ABOVE it — a native Modal opens in its own window —
 * must hide itself while this is true. src/components/ui/Modal.tsx does that
 * for every sheet; nothing should use react-native's Modal directly.
 */
export const AppLockContext = createContext(false);

export function useAppLocked(): boolean {
  return useContext(AppLockContext);
}
