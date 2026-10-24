/**
 * Column geometry for the Dashboard on a wide screen (iPhone Duo's open
 * display). Pure so the arithmetic is checkable in the plain-Node BDD suite;
 * the screen only decides what to draw in each column.
 *
 * See docs/design/duo-dashboard-grid-spec.md §3.
 */
import { donutSize } from './chartLayout';

/** Content width (pt) from which the Dashboard lays out as two columns. */
export const REGULAR_CONTENT_MIN = 600;
/** Gap between the summary column and the chart column. */
export const COLUMN_GAP = 16;
/** Gap between chart tiles, both across and down. */
export const GRID_GAP = 12;
/** Summary column's share of the two columns (mockup: 5fr / 6fr). */
export const LEFT_SHARE = 5 / 11;

/** Horizontal padding inside a chart tile, per side. */
const TILE_PADDING = 16;

export interface DashboardLayout {
  columns: 1 | 2;
  /** Width of the summary column (columns === 2) or the whole content (1). */
  leftWidth: number;
  /** Width of the chart column (0 when columns === 1). */
  rightWidth: number;
  /** Width of one chart tile in the 2×2 grid (0 when columns === 1). */
  tileWidth: number;
  /** Drawable width inside a tile, its 16pt side padding removed. */
  tileContentWidth: number;
  /** Ring diameter for the two category tiles (donutSize of tileContentWidth). */
  tileDonut: number;
}

export function dashboardLayout(contentWidth: number): DashboardLayout {
  // A non-finite width (NaN, ±Infinity) behaves as 0; a negative one is
  // clamped, so no field below can go negative.
  const width = Number.isFinite(contentWidth) ? Math.max(0, contentWidth) : 0;

  if (width < REGULAR_CONTENT_MIN) {
    return { columns: 1, leftWidth: width, rightWidth: 0, tileWidth: 0, tileContentWidth: 0, tileDonut: 0 };
  }

  const leftWidth = Math.round((width - COLUMN_GAP) * LEFT_SHARE);
  const rightWidth = width - COLUMN_GAP - leftWidth;
  const tileWidth = Math.floor((rightWidth - GRID_GAP) / 2);
  const tileContentWidth = Math.max(0, tileWidth - TILE_PADDING * 2);
  return {
    columns: 2,
    leftWidth,
    rightWidth,
    tileWidth,
    tileContentWidth,
    tileDonut: donutSize(tileContentWidth),
  };
}
