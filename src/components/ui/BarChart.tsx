import React from 'react';
import Svg, { G, Line, Rect } from 'react-native-svg';
import { colors } from '../../theme/tokens';

export interface CashFlowBucket {
  start: number;
  income: number;
  expense: number;
}

/**
 * Cash-flow bar chart: income bars rise above the zero line (green), expense
 * bars drop below it (red). Both sides share the same y-scale so you can
 * directly compare magnitudes. Empty buckets render as a gap (zero height).
 *
 * Any non-zero value is given a minimum visible height so a small amount next
 * to a much larger one (e.g. a $60 expense beside $39k income) still shows as a
 * sliver rather than rounding to an invisible sub-pixel bar.
 */
const MIN_BAR_H = 2;

export function BarChart({
  data,
  width = 300,
  height = 96,
}: {
  data: CashFlowBucket[];
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;

  const maxVal = Math.max(...data.flatMap((d) => [d.income, d.expense]), 1);
  const pad = 6;
  const halfH = (height - pad * 2) / 2;
  const zeroY = pad + halfH;
  const bucketW = width / data.length;
  const barW = Math.max(1.5, bucketW * 0.55);
  const barOffset = (bucketW - barW) / 2;
  /** Scale a value to a bar height, flooring non-zero values so they stay visible. */
  const barHeight = (v: number) =>
    v > 0 ? Math.max(MIN_BAR_H, (v / maxVal) * halfH) : 0;

  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {/* subtle grid lines */}
      <Line x1="0" y1={pad} x2={width} y2={pad} stroke="#23303f" strokeDasharray="2 4" />
      <Line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke={colors.border} strokeWidth={1} />
      <Line x1="0" y1={height - pad} x2={width} y2={height - pad} stroke="#23303f" strokeDasharray="2 4" />

      {data.map((d, i) => {
        const x = i * bucketW + barOffset;
        const incH = barHeight(d.income);
        const expH = barHeight(d.expense);
        return (
          <G key={i}>
            {d.income > 0 && (
              <Rect
                x={x}
                y={zeroY - incH}
                width={barW}
                height={incH}
                fill={colors.positive}
                opacity={0.85}
                rx={1.5}
              />
            )}
            {d.expense > 0 && (
              <Rect
                x={x}
                y={zeroY}
                width={barW}
                height={expH}
                fill={colors.negative}
                opacity={0.85}
                rx={1.5}
              />
            )}
          </G>
        );
      })}
    </Svg>
  );
}
