/**
 * ThemeProvider — owns the user's Appearance preference (system/light/dark),
 * persists it, and drives NativeWind's runtime colour scheme so every
 * className consumer (and useThemeColors() hook consumer) re-themes.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { colorScheme } from 'nativewind';
import { getTheme, setTheme, ThemePreference } from '../features/settings/repository';

// Default to dark at module load, before the persisted pref has loaded, so
// there's no light-mode flash while the async read resolves (dark is today's
// only theme, so this matches the pre-Stage-2b behaviour exactly).
colorScheme.set('dark');

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
      colorScheme.set(stored);
    });
  }, []);

  const setPref = useCallback((next: ThemePreference) => {
    setPrefState(next);
    colorScheme.set(next);
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
