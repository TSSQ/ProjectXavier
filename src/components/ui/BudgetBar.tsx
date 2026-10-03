/**
 * BudgetBar — the one bar every budget surface draws (monthly-budgets spec §5,
 * mockup "budget bar"): a recessed track; a solid fill for what is spent
 * (primary / gold / negative by state); a hatched segment for what is
 * scheduled (muted); an optional ghost segment for a purchase being asked
 * about (hatched primary, or negative when it would overshoot); an optional
 * Today tick; and, when the ghost overshoots, a cap line at the end. Thick
 * (8pt) and thin (5pt) variants. Hatching is drawn with react-native-svg.
 *
 * All inputs are plain numbers; the geometry is the pure `barGeometry` below.
 */
import React, { useState } from 'react';
import { View, Text, LayoutChangeEvent, ViewStyle } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { radius, ThemeColors } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';
import type { BudgetState } from '../../domain/budgets';
import { barGeometry, clamp01 } from '../../domain/barGeometry';
import { warnColor } from './StatusChip';

export function fillColor(c: ThemeColors, state: BudgetState): string {
  return state === 'over' ? c.negative : state === 'warn' ? warnColor(c) : c.primary;
}

/** Diagonal hatch across a `width` x `height` box. */
function Hatch({
  width,
  height,
  color,
  gap,
  stroke,
}: {
  width: number;
  height: number;
  color: string;
  gap: number;
  stroke: number;
}) {
  const lines: number[] = [];
  for (let x = -height; x < width; x += gap) lines.push(x);
  return (
    <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
      {lines.map((x) => (
        <Line key={x} x1={x} y1={height} x2={x + height} y2={0} stroke={color} strokeWidth={stroke} />
      ))}
    </Svg>
  );
}

export interface BudgetBarProps {
  budget: number;
  spent: number;
  scheduled?: number;
  state: BudgetState;
  /** Today's tick as a 0..1 share of the budget; omit outside the current month. */
  tick?: number | null;
  /** The thin variant (5pt) for list rows. */
  thin?: boolean;
  /** A purchase being asked about; `over` colours it negative. */
  ghost?: { amount: number; over: boolean } | null;
  style?: ViewStyle;
}

export function BudgetBar({
  budget,
  spent,
  scheduled = 0,
  state,
  tick = null,
  thin = false,
  ghost = null,
  style,
}: BudgetBarProps) {
  const c = useThemeColors();
  const [width, setWidth] = useState(0);
  const height = thin ? 5 : 8;
  const g = barGeometry({ budget, spent, scheduled, ghostAmount: ghost?.amount ?? null });
  const ghostColor = ghost?.over ? c.negative : c.primary;
  const px = (share: number) => share * width;
  const tickInset = thin ? 3 : 4;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      onLayout={onLayout}
      style={{
        height,
        borderRadius: radius.pill,
        backgroundColor: c.wellRecessed,
        marginTop: thin ? 6 : 8,
        ...style,
      }}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: Math.max(budget, 1), now: Math.max(0, spent + scheduled) }}
    >
      {g.fill > 0 && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${g.fill * 100}%`,
            borderRadius: radius.pill,
            backgroundColor: fillColor(c, state),
          }}
        />
      )}
      {g.scheduled > 0 && width > 0 && (
        <View
          style={{
            position: 'absolute',
            left: px(g.scheduledStart),
            top: 0,
            bottom: 0,
            width: px(g.scheduled),
            borderTopRightRadius: radius.pill,
            borderBottomRightRadius: radius.pill,
            overflow: 'hidden',
          }}
        >
          <Hatch width={px(g.scheduled)} height={height} color={c.muted} gap={5} stroke={2} />
        </View>
      )}
      {g.ghost > 0 && width > 0 && (
        <View
          style={{
            position: 'absolute',
            left: px(g.ghostStart),
            top: 0,
            bottom: 0,
            width: px(g.ghost),
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: ghostColor,
            overflow: 'hidden',
          }}
        >
          <Hatch width={px(g.ghost)} height={height} color={ghostColor} gap={6} stroke={3} />
        </View>
      )}
      {tick != null && (
        <View
          style={{
            position: 'absolute',
            left: `${clamp01(tick) * 100}%`,
            top: -tickInset,
            bottom: -tickInset,
            width: 2,
            borderRadius: radius.xs,
            backgroundColor: c.text,
          }}
        />
      )}
      {g.capped && (
        <View
          style={{
            position: 'absolute',
            right: 0,
            top: -3,
            bottom: -3,
            width: 2,
            backgroundColor: c.muted,
          }}
        />
      )}
    </View>
  );
}

/** The "Today" label under a tick, centred on it (mockup `.ticklbl`). */
export function TodayLabel({ tick }: { tick: number }) {
  const c = useThemeColors();
  return (
    <View style={{ height: 14, marginTop: 3 }}>
      <View style={{ position: 'absolute', left: `${clamp01(tick) * 100}%`, width: 0, alignItems: 'center' }}>
        <Text
          numberOfLines={1}
          style={{ position: 'absolute', width: 48, left: -24, textAlign: 'center', fontSize: 9.5, color: c.muted }}
        >
          Today
        </Text>
      </View>
    </View>
  );
}

/** The legend swatch: solid (spent) or hatched (scheduled). */
export function LegendSwatch({ hatched }: { hatched?: boolean }) {
  const c = useThemeColors();
  return (
    <View
      style={{
        width: 9,
        height: 9,
        borderRadius: radius.xs,
        marginRight: 4,
        backgroundColor: hatched ? 'transparent' : c.primary,
        borderWidth: hatched ? 1 : 0,
        borderColor: c.muted,
        overflow: 'hidden',
      }}
    >
      {hatched && <Hatch width={9} height={9} color={c.muted} gap={4} stroke={1.5} />}
    </View>
  );
}
