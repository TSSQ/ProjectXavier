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

/** Largest ring we will draw, however wide the phone. Past this a donut stops
 *  reading as a chart and starts reading as decoration, and every page pays
 *  for it in height through the shared slide floor. */
const DONUT_MAX = 190;
/** Share of the slide the ring occupies. Just over half leaves the ring
 *  clearly dominant without crowding the wrapped legend beneath it. */
const DONUT_SHARE = 0.52;

/**
 * Ring diameter for a given slide.
 *
 * Derived rather than fixed: the ring is centred now, so it has the whole
 * slide width to sit in, and a constant that looks right on a 430pt phone
 * looks oversized on a 375pt one. Capped so a future larger screen does not
 * turn the dashboard into one enormous ring.
 */
export function donutSize(contentWidth: number): number {
  return Math.max(0, Math.round(Math.min(contentWidth * DONUT_SHARE, DONUT_MAX)));
}

export interface ChartSlideLayout {
  /** Width of one page in the horizontal pager. */
  slideWidth: number;
  /** Drawable width inside a slide, once its own padding is removed. */
  contentWidth: number;
  /** Shared drawing height for every chart. Tracks the ring so no page
   *  carries a visibly smaller mark than its neighbours. */
  chartHeight: number;
  /** Ring diameter for the two category pages. */
  donut: number;
}

export function chartSlideLayout(screenWidth: number): ChartSlideLayout {
  const slideWidth = Math.max(0, screenWidth - CARD_PADDING * 2);
  const donut = donutSize(Math.max(0, slideWidth - SLIDE_PADDING * 2));
  return {
    slideWidth,
    // Never negative: a hostile or zero width must not produce a chart with a
    // negative viewBox, which renders as an invisible or inverted axis rather
    // than an obvious failure.
    contentWidth: Math.max(0, slideWidth - SLIDE_PADDING * 2),
    // The line and bar marks grow with the ring rather than staying at the
    // old 120: leaving them short would just move the dead space from the
    // category pages onto theirs.
    chartHeight: Math.max(CHART_HEIGHT, donut),
    donut,
  };
}
