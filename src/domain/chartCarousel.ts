/**
 * Pure page metadata for the dashboard's swipeable chart card
 * (app/(tabs)/dashboard.tsx's `ScrollView horizontal pagingEnabled` carousel).
 * Framework-free and exported here — not inlined in the screen — so a future
 * edit that reverts the 4-page header/dots to a stale 2-page assumption is
 * caught by the plain-Node BDD suite rather than only a visual scan.
 */

/** The carousel's pages, in swipe order. Indexes both the header title and
 *  the page dots below. */
export const CHART_TITLES = [
  'Account balances',
  'Cash flow',
  'Expenses by category',
  'Income by category',
] as const;

export const CHART_PAGE_COUNT = CHART_TITLES.length;

/** The chart carousel's header title for `page`, clamped to a valid page
 *  index so a momentary out-of-range scroll offset never renders
 *  `undefined` instead of a title. */
export function titleForChartPage(page: number): string {
  const clamped = Math.min(Math.max(page, 0), CHART_TITLES.length - 1);
  return CHART_TITLES[clamped]!;
}
