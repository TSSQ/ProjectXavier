import React from 'react';
import Svg, { Path, Line } from 'react-native-svg';

export interface ChartSeries {
  color: string;
  /** Balance samples (same length / sample times across all series). */
  values: number[];
  dashed?: boolean;
}

/**
 * Minimal multi-line chart: one line per account's balance across the selected
 * period. All series share a single y-scale so relative heights are comparable.
 */
export function MultiLineChart({
  series,
  width = 300,
  height = 96,
}: {
  series: ChartSeries[];
  width?: number;
  height?: number;
}) {
  const all = series.flatMap((s) => s.values);
  if (all.length < 2) return null;

  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const len = Math.max(...series.map((s) => s.values.length));
  if (len < 2) return null;
  const stepX = width / (len - 1);
  const pad = 6;

  const toPath = (values: number[]) =>
    values
      .map((v, i) => {
        const x = i * stepX;
        const y = height - pad - ((v - min) / span) * (height - pad * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <Line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} stroke="#23303f" strokeDasharray="2 4" />
      <Line x1="0" y1={height * 0.65} x2={width} y2={height * 0.65} stroke="#23303f" strokeDasharray="2 4" />
      {series.map((s, i) => (
        <Path
          key={i}
          d={toPath(s.values)}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeDasharray={s.dashed ? '6 4' : undefined}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}
