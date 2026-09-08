/**
 * Badge — the shared read-only label (glass-standard-adoption-spec.md S3,
 * style guide F6). Never glass, never pressable: `badgeFlat` fill + a
 * hairline border, one size (`label`, 11pt, uppercase, tracked), three tones.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { radius } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';

export interface BadgeProps {
  label: string;
  tone?: 'muted' | 'primary' | 'negative';
}

export function Badge({ label, tone = 'muted' }: BadgeProps) {
  const c = useThemeColors();
  const s = useScaledType();
  const color = tone === 'primary' ? c.primary : tone === 'negative' ? c.negative : c.muted;
  const borderColor = tone === 'primary' ? c.borderAccent : c.border;

  return (
    <View
      style={{
        backgroundColor: c.badgeFlat,
        borderWidth: 1,
        borderColor,
        borderRadius: radius.pill,
        paddingHorizontal: 7,
        paddingVertical: 3,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize: s.role.label,
          fontWeight: '700',
          color,
          textTransform: 'uppercase',
          // .09 EM (QA round 3), not .09pt: RN's `letterSpacing` is points,
          // so a bare 0.09 at an 11pt type size was visually nothing — about
          // 60% LESS tracking than the `tracking-wide` (~0.025em) class this
          // replaced. Scaling by the badge's own rendered size keeps it
          // proportional at every Dynamic Type step, same as the em the
          // style guide's "tracking .09" always meant.
          letterSpacing: s.role.label * 0.09,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
