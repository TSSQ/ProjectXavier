/**
 * StatusChip — the small read-only state pill the budget surfaces use
 * (`ok` / `warn` / `over` / `info`). State is always carried by its label as
 * well as its colour. Colours come from existing tokens only: the ok and over
 * fills are the amount tokens the transaction rows already use, `info` is
 * surfaceBlue, and `warn` is the `warn` token on `warnBg`: the ok and over chips use
 * amountPosBg and amountNegBg, i.e. the mockup's posBg and negBg.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { radius, ThemeColors } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';

export type StatusTone = 'ok' | 'warn' | 'over' | 'info';

/** The foreground gold for warn text and fills (the `warn` token). */
export function warnColor(c: ThemeColors): string {
  return c.warn;
}

export function toneColors(
  c: ThemeColors,
  tone: StatusTone
): { bg: string; fg: string } {
  switch (tone) {
    case 'ok':
      return { bg: c.amountPosBg, fg: c.amountPosFg };
    case 'warn':
      // The mockup's --goldBg, per theme (warnBg token).
      return { bg: c.warnBg, fg: warnColor(c) };
    case 'over':
      return { bg: c.amountNegBg, fg: c.amountNegFg };
    default:
      return { bg: c.surfaceBlue, fg: c.primary };
  }
}

export function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  const c = useThemeColors();
  const { bg, fg } = toneColors(c, tone);
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: bg,
        borderRadius: radius.pill,
        paddingHorizontal: 7,
        paddingVertical: 2,
      }}
    >
      <Text numberOfLines={1} style={{ color: fg, fontSize: 10, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}
