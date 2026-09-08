/**
 * IconButton — the shared floating icon control (glass-standard-adoption-
 * spec.md S2, style guide F2). Three sizes: `lg` (the composer's "+"), `md`
 * (Send, sheet-shell close discs, header search), `sm` (the composer's bare
 * camera glyph — no glass at all, matching R1's "glass is chrome, not every
 * touch target").
 *
 * `tone` picks the glass material for `lg`/`md` — `clear` at rest, `tinted`
 * for the one primary action (Send). `sm` ignores it: it never carries glass.
 */
import React, { useState } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Glass } from './Glass';
import { radius, SIZE } from '../../theme/tokens';
import { ICON } from '../../theme/assets';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';
import { useGlass } from '../../theme/useGlass';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** The `md` box size, derived from `composerHeight` — exported (QA round 4)
 *  so `BottomSheet`'s header spacer (which has to match this exact box to
 *  balance the close button's title) imports the real formula instead of
 *  hand-copying `s.composerHeight - 12` a third time, the same reasoning
 *  `SIZE.fab` already exists for elsewhere in this file's family. */
export function mdIconBoxSize(composerHeight: number): number {
  return composerHeight - 12;
}

export interface IconButtonProps {
  size: 'lg' | 'md' | 'sm';
  /** Ignored when `size === 'sm'` — the small tier never carries glass. */
  tone?: 'clear' | 'tinted';
  icon: FeatherName;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  /**
   * Whether the `lg`/`md` box mounts through `Glass`. Default true. Pass
   * `false` while an ancestor is still mid Reanimated `entering` animation
   * (or hasn't settled yet) — a `GlassView` applies its native effect
   * exactly once, on first layout, and loses it for good if that layout
   * lands mid-animation (Glass.tsx header, style guide R9). When false,
   * this renders the SAME box with the SAME fallback fill + edge `Glass`
   * itself uses for `tone` on the opaque tier, so nothing reflows when the
   * caller flips this back to `true` after settling (`BottomSheet`'s own
   * `showGlass` gate). `size="sm"` never carries glass and ignores this.
   */
  glass?: boolean;
}

export function IconButton({
  size,
  tone = 'clear',
  icon,
  onPress,
  accessibilityLabel,
  disabled = false,
  glass = true,
}: IconButtonProps) {
  const c = useThemeColors();
  const s = useScaledType();
  const { tokens } = useGlass();
  const [pressed, setPressed] = useState(false);

  const pressableStyle = {
    opacity: disabled ? 0.35 : pressed ? 0.85 : 1,
  };

  if (size === 'sm') {
    return (
      <Pressable
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        style={{
          width: SIZE.glyphBox,
          height: SIZE.glyphBox,
          alignItems: 'center',
          justifyContent: 'center',
          ...pressableStyle,
        }}
      >
        <Feather name={icon} size={ICON.md} color={c.muted} />
      </Pressable>
    );
  }

  const box = size === 'lg' ? s.composerHeight : mdIconBoxSize(s.composerHeight);
  const glyphSize = size === 'lg' ? ICON.lg : ICON.md;
  const glyphColor = tone === 'tinted' ? c.onAccent : c.text;
  const roleTokens = tokens[tone];

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      hitSlop={size === 'md' ? 6 : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={pressableStyle}
    >
      {glass ? (
        <Glass
          material={tone}
          radius={radius.pill}
          isInteractive
          style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name={icon} size={glyphSize} color={glyphColor} />
        </Glass>
      ) : (
        // Opaque-tier lookalike, not a real Glass mount (R9) — same box,
        // same fallback fill, edge AND specular lip Glass itself draws for
        // `tone` on the opaque tier (QA round 2 MINOR 3: `showGlass` gates
        // on `tier === 'native'`, so on the opaque tier THIS branch is what
        // every `glass={false}` caller — the sheet close button — renders
        // permanently; missing the lip meant it alone lacked the highlight
        // every other `clear` IconButton shows). Border width matches
        // Glass's own `edge` shape (StyleSheet.hairlineWidth,
        // unconditionally) so swapping this for `<Glass>` once the caller
        // flips `glass` to true never reflows the button by a hairline
        // (see Composer.tsx's fix for the bug this avoids).
        <View
          style={{
            width: box,
            height: box,
            borderRadius: radius.pill,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: roleTokens.fallback,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: roleTokens.edge,
          }}
        >
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
          <Feather name={icon} size={glyphSize} color={glyphColor} />
        </View>
      )}
    </Pressable>
  );
}
