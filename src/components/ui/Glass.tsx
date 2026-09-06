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
 *
 * Mount-timing caveats (the canonical description — ScreenHeader.tsx and
 * BottomSheet.tsx defer to this): expo-glass-effect's GlassView assigns its
 * UIGlassEffect from `updateEffect()` on its FIRST `layoutSubviews`
 * (expo/expo#41024) and again whenever tintColor / style / isInteractive
 * change. Two situations leave the effect invisible on that instance:
 *   1. the first layout lands while an ANCESTOR is mid Reanimated layout
 *      animation — the effect never renders, and re-supplying props
 *      afterwards does not recover it. The caller must delay this
 *      component's first mount (BottomSheet keys it on settle; ScreenHeader
 *      keys it on the measured height so a resize gets a fresh instance).
 *   2. a prop change reaches an instance whose screen is DETACHED (a
 *      NativeTabs tab that is mounted but not visible) — the re-assigned
 *      effect renders nothing on the tab's next appearance. A colour-scheme
 *      change is exactly that (new tint), so this component keys its
 *      GlassView on the scheme: the remount's first layout happens on
 *      attach, which always works. Cost: children remount on a theme switch
 *      (the composer field loses focus); and if the switch lands while an
 *      ancestor is animating, case 1 applies to that one instance until
 *      its next remount — a narrow window accepted over the reproduced
 *      background-tab blank-out.
 * A caller passing its own `key` composes with the internal one (React keys
 * are per element, and the scheme key is on the inner GlassView).
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
        // Fresh native instance per colour scheme. A scheme change hands the
        // SAME GlassView a new tintColor, which re-assigns its UIGlassEffect
        // (GlassView.swift setTintColor → updateEffect). On the visible tab
        // that is fine; on a tab NativeTabs keeps mounted but detached, the
        // re-assigned effect renders nothing on the tab's next appearance
        // (header see-through, FAB without its disc — reproduced on the sim).
        // A keyed remount gets its first layoutSubviews on attach instead,
        // the path that always works.
        key={scheme}
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
