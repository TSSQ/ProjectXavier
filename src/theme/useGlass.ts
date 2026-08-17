/**
 * useGlass — resolves the active glass tokens and rendering tier.
 *
 * Split from glassTokens.ts because this half touches React and RN
 * (useColorScheme, AccessibilityInfo); the decision it delegates to
 * (`resolveGlassTier`) stays pure and BDD-tested over there.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { useColorScheme } from 'nativewind';
import { isLiquidGlassAvailable, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { GLASS_UI_ENABLED } from '../lib/flags';
import { GlassTier, GlassTokens, glassTokensFor, resolveGlassTier } from './glassTokens';

export interface GlassContext {
  tier: GlassTier;
  tokens: GlassTokens;
  /** The app's own scheme, forwarded to GlassView's `colorScheme` prop so the
   *  material follows the in-app Appearance setting rather than the system's
   *  — they diverge whenever the user overrides the theme in Settings. */
  scheme: 'dark' | 'light';
}

export function useGlass(): GlassContext {
  const { colorScheme } = useColorScheme();
  const scheme: 'dark' | 'light' = colorScheme === 'dark' ? 'dark' : 'light';

  // Reduce Transparency is a live setting, not a launch-time constant, so it
  // is subscribed to rather than read once. `isLiquidGlassAvailable()` does
  // NOT report it — see resolveGlassTier's note.
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((on) => {
        if (!cancelled) setReduceTransparency(on);
      })
      .catch(() => {
        // Unreadable setting: stay on the safe side and keep the last known
        // value rather than assuming transparency is welcome.
      });
    const sub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const tier = resolveGlassTier({
    flagEnabled: GLASS_UI_ENABLED,
    // Both native gates are false off-iOS, so no Platform check is needed
    // here — but the API one guards a real crash on some iOS 26 betas.
    liquidGlassAvailable: isLiquidGlassAvailable(),
    glassApiAvailable: isGlassEffectAPIAvailable(),
    reduceTransparency,
  });

  return { tier, tokens: glassTokensFor(scheme), scheme };
}
