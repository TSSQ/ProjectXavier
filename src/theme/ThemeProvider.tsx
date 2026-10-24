/**
 * ThemeProvider — owns the user's Appearance preference (system/light/dark),
 * persists it, and drives NativeWind's runtime colour scheme so every
 * className consumer (and useThemeColors() hook consumer) re-themes.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Appearance } from 'react-native';
import { colorScheme } from 'nativewind';
import { getTheme, setTheme, ThemePreference } from '../features/settings/repository';

// Default to dark at module load, before the persisted pref has loaded, so
// there's no light-mode flash while the async read resolves (dark is today's
// only theme, so this matches the pre-Stage-2b behaviour exactly).
colorScheme.set('dark');

/**
 * Apply an Appearance preference to NativeWind AND to React Native.
 *
 * NativeWind's `colorScheme.set('system')` calls `Appearance.setColorScheme(null)`.
 * React Native 0.88 only re-reads the native scheme for 'auto'/'unspecified';
 * `null` falls through and is CACHED as the current scheme, so every later
 * `Appearance.getColorScheme()` (NativeWind's AppState→active refresh included)
 * answers null → "light", and a phone set to Dark stays light under "System"
 * (reported on device after the SDK 58 upgrade). Passing 'unspecified' through
 * React Native's own API clears the window override on every connected scene
 * and re-reads the real system value, so NativeWind's listeners see it.
 */
export function applyThemePreference(pref: ThemePreference): void {
  colorScheme.set(pref);
  if (pref === 'system') Appearance.setColorScheme('unspecified');
}

interface ThemeContextValue {
  pref: ThemePreference;
  setPref: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  pref: 'system',
  setPref: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<ThemePreference>('dark');

  useEffect(() => {
    getTheme().then((stored) => {
      setPrefState(stored);
      applyThemePreference(stored);
    });
  }, []);

  const setPref = useCallback((next: ThemePreference) => {
    setPrefState(next);
    applyThemePreference(next);
    void setTheme(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ pref, setPref }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
