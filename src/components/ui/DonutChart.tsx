import React from 'react';
import Svg, { Circle, G } from 'react-native-svg';

export interface DonutSlice {
  value: number;
  color: string;
}

/**
 * A ring of flat-colour arc segments, one per slice, proportional to
 * `value / total`. Used by the dashboard's expense/income category-breakdown
 * cards. Flat colours need no gradient defs (unlike Sparkline.tsx), so there's
 * no document-global id to worry about.
 *
 * Renders nothing when there are no slices or the total is 0 — callers should
 * show an empty state instead (see dashboard.tsx).
 */
export function DonutChart({
  slices,
  size = 120,
  strokeWidth = 16,
}: {
  slices: DonutSlice[];
  size?: number;
  strokeWidth?: number;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (slices.length === 0 || total <= 0) return null;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let drawnSoFar = 0;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Rotate -90° so the first slice starts at 12 o'clock, matching the
          legend's reading order. */}
      <G rotation={-90} originX={center} originY={center}>
        {slices.map((slice, i) => {
          if (slice.value <= 0) return null;
          const dash = (slice.value / total) * circumference;
          const gap = circumference - dash;
          const strokeDashoffset = -drawnSoFar;
          drawnSoFar += dash;
          return (
            <Circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={strokeDashoffset}
            />
          );
        })}
      </G>
    </Svg>
  );
}
