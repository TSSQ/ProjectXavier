import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * True only while the calling screen is the focused one AND the app is in
 * the foreground — i.e. while anything it animates can actually be seen.
 *
 * NativeTabs keeps every visited tab mounted, so an animation that only
 * checks Reduce Motion keeps running on a tab nobody is looking at, and in
 * the background (issue #27). Gate continuous motion on this instead.
 */
export function useScreenActive(): boolean {
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  useEffect(() => {
    // 'inactive' (Control Center, the Face ID sheet, a call banner) still
    // shows the screen, so only 'background' stops the motion.
    const sub = AppState.addEventListener('change', (next) => {
      setForeground(next !== 'background');
    });
    return () => sub.remove();
  }, []);

  return focused && foreground;
}
