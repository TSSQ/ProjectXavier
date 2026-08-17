/**
 * `<Glass>` — the single glass surface primitive (Phase 1 of the Apple Glass
 * UI proposal).
 *
 * The proposal's rule is "wrap everything in a single primitive so no screen
 * ever branches", and that is the whole point: the tier decision, the
 * accessibility fallback and the edge/specular treatment live here once,
 * rather than as an `isLiquidGlassAvailable()` check copied into every screen
 * (which is how the POC tab bar got the Reduce Transparency case wrong).
 *
 * Layout is IDENTICAL across tiers — same radius, same padding, same size —
 * so switching tiers never reflows a screen. Only the fill changes.
 *
 *   <Glass material="card" radius={radius.md}>…</Glass>
 *   <Glass material="chrome" radius={radius.pill}>…</Glass>
 *
 * `GlassContainer` is re-exported rather than wrapped: merging is a property
 * of a GROUP of surfaces (the FAB cluster), not of one, so it belongs at the
 * call site in Phase 2.
 */
import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { useGlass } from '../../theme/useGlass';
import { GlassRole } from '../../theme/glassTokens';

export { GlassContainer } from 'expo-glass-effect';

export interface GlassProps extends ViewProps {
  /** Which material this surface is. See GlassRole for what each is for.
   *  Named `material`, not `role`: RN's ViewProps.role is the ACCESSIBILITY
   *  role, and shadowing it would make it impossible to mark a glass surface
   *  as a button or header. */
  material?: GlassRole;
  /** Corner radius. Pass the same value you'd give the flat surface — the
   *  proposal keeps every existing radius unchanged. */
  radius?: number;
  /** Draw the hairline edge. On by default; turn it off for a surface that
   *  sits flush inside another glass shape. */
  edge?: boolean;
  /** Draw the 1px top-edge highlight. RN has no inset box-shadow, so this is
   *  an overlay View rather than a shadow — see glassTokens.ts. */
  specular?: boolean;
  /** Forwarded to GlassView; use for controls that respond to touch. */
  isInteractive?: boolean;
}

export function Glass({
  material = 'card',
  radius = 14,
  edge = true,
  specular = true,
  isInteractive = false,
  style,
  children,
  ...rest
}: GlassProps) {
  const { tier, tokens, scheme } = useGlass();
  const roleTokens = tokens[material];

  const shape = {
    borderRadius: radius,
    overflow: 'hidden' as const,
    ...(edge ? { borderWidth: StyleSheet.hairlineWidth, borderColor: roleTokens.edge } : null),
  };

  // The top-edge lip. Sits above the material and below the content, and is
  // pointerEvents="none" so it can never eat a touch.
  const lip = specular ? (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: StyleSheet.hairlineWidth,
        backgroundColor: roleTokens.specular,
      }}
    />
  ) : null;

  if (tier === 'native') {
    return (
      <GlassView
        glassEffectStyle={roleTokens.systemStyle}
        tintColor={roleTokens.tint}
        isInteractive={isInteractive}
        // Follow the app's own Appearance setting, not the system's — they
        // differ whenever the user overrides the theme in Settings.
        colorScheme={scheme}
        style={[shape, style]}
        {...rest}
      >
        {lip}
        {children}
      </GlassView>
    );
  }

  // Opaque tier — iOS < 26 is impossible here (deployment target 26.0), so
  // this is Reduce Transparency, an iOS 26 beta without the API, the flag
  // being off, or a non-iOS platform. Same geometry, flat fill.
  return (
    <View style={[shape, { backgroundColor: roleTokens.fallback }, style]} {...rest}>
      {lip}
      {children}
    </View>
  );
}
