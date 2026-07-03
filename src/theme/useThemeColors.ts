/**
 * useThemeColors — resolves the active palette (dark or light) from
 * NativeWind's runtime colour scheme. Components should read colours through
 * this hook instead of importing the static `colors` export, so they re-theme
 * when the user switches Appearance in Settings.
 */
import { useColorScheme } from 'nativewind';
import { darkColors, lightColors, ThemeColors } from './tokens';

export function useThemeColors(): ThemeColors {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark' ? darkColors : lightColors;
}
