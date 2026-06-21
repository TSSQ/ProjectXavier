import React from 'react';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

/** Minimal area sparkline from a numeric series (e.g. net flow per period). */
export function Sparkline({
  values,
  width = 280,
  height = 64,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
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
        <LinearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7CA6FF" stopOpacity="0.45" />
          <Stop offset="1" stopColor="#7CA6FF" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#spark)" />
      <Path
        d={line}
        fill="none"
        stroke="#7CA6FF"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
