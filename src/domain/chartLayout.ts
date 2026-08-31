/**
 * Geometry for the dashboard's paged chart carousel.
 *
 * Pure so the arithmetic is checkable without a device. It replaced three
 * magic numbers that disagreed with each other: the slides are sized from the
 * screen, but MultiLineChart and BarChart defaulted to a hardcoded width of
 * 300. That left ~50pt of dead space inside each slide on a large phone and
 * OVERFLOWED the slide on a small one — the charts were the only thing on the
 * dashboard not sized from the screen.
 */

/** Horizontal padding on the dashboard card, per side. */
const CARD_PADDING = 24;
/** Horizontal padding inside each slide, per side. */
const SLIDE_PADDING = 16;

/**
 * One shared drawing height for every chart in the carousel.
 *
 * The four slides used to differ: line and bar drew at 96 while the donut
 * slides drew a 92pt ring beside a legend whose height grows with the number
 * of categories. A paged ScrollView takes the height of its tallest page, so
 * the short pages carried dead space and the carousel appeared to resize as
 * you swiped. Matching the tallest — the donut slide with a full legend — is
 * what "make the smallest follow the biggest" means here.
 */
export const CHART_HEIGHT = 120;

export interface ChartSlideLayout {
  /** Width of one page in the horizontal pager. */
  slideWidth: number;
  /** Drawable width inside a slide, once its own padding is removed. */
  contentWidth: number;
  /** Shared drawing height for every chart. */
  chartHeight: number;
}

export function chartSlideLayout(screenWidth: number): ChartSlideLayout {
  const slideWidth = Math.max(0, screenWidth - CARD_PADDING * 2);
  return {
    slideWidth,
    // Never negative: a hostile or zero width must not produce a chart with a
    // negative viewBox, which renders as an invisible or inverted axis rather
    // than an obvious failure.
    contentWidth: Math.max(0, slideWidth - SLIDE_PADDING * 2),
    chartHeight: CHART_HEIGHT,
  };
}
