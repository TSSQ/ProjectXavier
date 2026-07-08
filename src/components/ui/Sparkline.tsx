import React from 'react';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useThemeColors } from '../../theme/useThemeColors';

/** Minimal area sparkline from a numeric series (e.g. net flow per period). */
export function Sparkline({
  values,
  width = 280,
  height = 64,
  color,
  floor,
}: {
  values: number[];
  width?: number;
  height?: number;
  /** Stroke/fill color; defaults to the theme primary. */
  color?: string;
  /** Force the y-baseline down to this value (e.g. 0 for magnitude series —
   *  normalizing to the series min would exaggerate small variations). */
  floor?: number;
}) {
  const c = useThemeColors();
  const stroke = color ?? c.primary;
  // Gradient ids are document-global in react-native-svg — two sparklines
  // with different colors on one screen must not share one id.
  const gradId = `spark-${stroke.replace(/[^a-zA-Z0-9]/g, '')}`;
  if (values.length < 2) return null;

  const min = floor != null ? Math.min(floor, ...values) : Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);

  const points = values.map((v, i) => ({
    x: i * stepX,
    y: height - ((v - min) / span) * (height - 6) - 3,
  }));
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity="0.45" />
          <Stop offset="1" stopColor={stroke} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d={area} fill={`url(#${gradId})`} />
      <Path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
