/**
 * Fab — the floating "add" action shared by Transactions, account detail,
 * manage-accounts, manage-categories and manage-payees (glass-standard-
 * adoption-spec.md S1, style guide F1). Replaces five identical inline
 * `<Glass material="tinted">` copies.
 *
 * `insets` are read here via `useSafeAreaInsets()` rather than threaded in —
 * every caller already sits inside a `SafeAreaProvider`, so there is nothing
 * for the prop to add except drift between the five copies.
 */
import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Glass } from './Glass';
import { radius, SIZE } from '../../theme/tokens';
import { ICON } from '../../theme/assets';
import { useThemeColors } from '../../theme/useThemeColors';
import { useGlass } from '../../theme/useGlass';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export interface FabProps {
  onPress: () => void;
  accessibilityLabel: string;
  icon?: FeatherName;
}

export function Fab({ onPress, accessibilityLabel, icon = 'plus' }: FabProps) {
  const insets = useSafeAreaInsets();
  const c = useThemeColors();
  const { tier } = useGlass();
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        position: 'absolute',
        right: 20,
        bottom: insets.bottom + 20,
        opacity: pressed ? 0.9 : 1,
        // The opaque-tier fallback is a SOLID primaryFill disc (Glass.tsx),
        // exactly the surface `accentGlow` is for (style guide R4) — glass
        // itself never carries painted depth, so the glow only applies here.
        ...(tier === 'opaque' ? { ...c.elevation.accentGlow, shadowColor: c.primary } : null),
      }}
    >
      <Glass
        material="tinted"
        radius={radius.pill}
        isInteractive
        style={{
          width: SIZE.fab,
          height: SIZE.fab,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name={icon} size={ICON.lg} color={c.onAccent} />
      </Glass>
    </Pressable>
  );
}
