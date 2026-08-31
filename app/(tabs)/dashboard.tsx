/**
 * Dashboard — a period-scoped overview. A period button (top-left) opens the
 * Period sheet (Month / Year / Date). For the selected period the screen shows
 * net worth at the period end with a per-account trend chart, the period's
 * income / expense / net, then each account's closing balance (rolled forward
 * from the previous period's close). Tap an account to drill in.
 *
 * Below the accounts section: a Planned list of upcoming recurring transactions
 * and a projected net-worth figure 30 days out.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePeriod } from '../../src/context/PeriodContext';
import { useIncludeArchived } from '../../src/context/useIncludeArchived';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  useWindowDimensions,
  LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Account, Category, Payee, Transaction, RecurringSeries } from '../../src/domain/types';
import {
  periodBalancesOf,
  netWorthOfAsOf,
  balanceSeries,
} from '../../src/domain/balances';
import { hasArchivedAccounts, accountsInScope } from '../../src/domain/accountArchive';
import {
  totalsForRange,
  cashFlowSeries,
  categoryBreakdown,
  CategorySlice,
  Granularity,
} from '../../src/domain/period';
import { formatMoney } from '../../src/domain/money';
import {
  Selection,
  isAllSelected,
  effectiveIds,
  selectAll,
  toggleAccount,
  scopeLabel,
} from '../../src/domain/accountFilter';
import { listAccounts } from '../../src/features/accounts/repository';
import { listTransactions } from '../../src/features/transactions/repository';
import { listCategories } from '../../src/features/categories/repository';
import { listPayees } from '../../src/features/payees/repository';
import {
  getCurrency,
  DEFAULT_CURRENCY,
  getAccountFilterCached,
  setAccountFilterSelection,
} from '../../src/features/settings/repository';
import { listSeries } from '../../src/features/recurring/repository';
import { upcomingOccurrences, upcomingTotals, seriesTitle } from '../../src/domain/recurrence';
import { accountIcon } from '../../src/lib/accountIcon';
import { accountColor } from '../../src/lib/accountColor';
import { categoryColor } from '../../src/lib/categoryColor';
import { MultiLineChart } from '../../src/components/ui/MultiLineChart';
import { BarChart } from '../../src/components/ui/BarChart';
import { Sparkline } from '../../src/components/ui/Sparkline';
import { DonutChart } from '../../src/components/ui/DonutChart';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { chartSlideLayout, CHART_HEIGHT } from '../../src/domain/chartLayout';

/** The donut ring matches the line/bar drawing height so no page carries a
 *  visibly smaller mark than its neighbours. */
const DONUT_SIZE = CHART_HEIGHT;
/** Chart height plus room for the legend row beneath it. Applied to EVERY
 *  slide: a paged ScrollView takes its tallest page, so without a shared floor
 *  the carousel appeared to resize while swiping. */
const SLIDE_MIN_HEIGHT = CHART_HEIGHT + 56;
import { ThemeColors } from '../../src/theme/tokens';
import { PeriodSheet } from '../../src/components/ui/PeriodSheet';
import { AccountFilterPills } from '../../src/components/ui/AccountFilterPills';
import { AccountFilterSheet } from '../../src/components/ui/AccountFilterSheet';
import { IncludeArchivedToggle } from '../../src/components/ui/IncludeArchivedToggle';
import { CHART_PAGE_COUNT, titleForChartPage } from '../../src/domain/chartCarousel';

const CHART_STEPS = 16;
const FORECAST_DAYS = 30;
const PLANNED_LIMIT = 6;
/** Legend rows shown per donut before the remainder collapses into "Other". */
const LEGEND_CAP = 6;

interface LegendItem {
  key: string;
  name: string;
  color: string;
  amount: number;
}

/** Turn category slices into legend rows, capping to LEGEND_CAP and summing
 *  the remainder into a single "Other" row so the ring still reads 100%. */
function buildLegend(
  slices: CategorySlice[],
  categoriesById: Map<string, Category>,
  // The whole resolved theme, not just the muted colour: the slice colours
  // come from c.chartPalette now, which is per-theme.
  c: ThemeColors
): LegendItem[] {
  const mutedColor = c.muted;
  const head = slices.slice(0, LEGEND_CAP);
  const rest = slices.slice(LEGEND_CAP);
  const items: LegendItem[] = head.map((s, i) => ({
    key: s.categoryId ?? 'uncategorised',
    name: s.categoryId ? (categoriesById.get(s.categoryId)?.name ?? 'Unknown') : 'Uncategorised',
    color: s.categoryId ? categoryColor(i, c) : mutedColor,
    amount: s.amount,
  }));
  if (rest.length > 0) {
    items.push({
      key: 'other',
      name: 'Other',
      color: categoryColor(items.length, c),
      amount: rest.reduce((sum, s) => sum + s.amount, 0),
    });
  }
  return items;
}

export default function DashboardScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [allSeries, setAllSeries] = useState<RecurringSeries[]>([]);
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const { sel, setSel } = usePeriod();
  const [includeArchived, setIncludeArchived] = useIncludeArchived();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Seeded from the cache app/_layout.tsx warms before this screen can ever
  // mount (getAccountFilterCached, src/features/settings/repository.ts), so
  // the FIRST render already shows the restored selection instead of
  // defaulting to "all accounts" and flipping a moment later — see
  // updateSelection below for how every change is persisted back.
  const [selection, setSelection] = useState<Selection>(() => getAccountFilterCached() ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chartPage, setChartPage] = useState(0);
  /**
   * Tallest slide seen, applied as a floor to all four so the carousel stops
   * resizing as you swipe.
   *
   * Measured rather than a constant, because the slides differ by their own
   * content — a donut with six legend rows against a line chart with two —
   * and that varies per user. A constant either under-reserves (and does
   * nothing, which is what SLIDE_MIN_HEIGHT did) or over-reserves and leaves
   * dead space for everyone.
   *
   * Only ever grows within a data generation, so applying it as minHeight
   * cannot feed back into a measurement loop: a slide already at the floor
   * measures exactly the floor. It resets when the underlying data changes,
   * so a batch of deleted transactions does not leave the card permanently
   * tall.
   */
  const [slideFloor, setSlideFloor] = useState(0);
  const onSlideLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setSlideFloor((prev) => (h > prev ? h : prev));
  }, []);
  const { width: screenWidth } = useWindowDimensions();
  // One source of truth for the carousel's geometry — the charts used to size
  // themselves from a hardcoded 300 while the slides sized from the screen.
  const { slideWidth, contentWidth, chartHeight } = chartSlideLayout(screenWidth);

  const refresh = useCallback(async () => {
    const [nextAccounts, nextTransactions, nextCategories, nextCurrency, series, nextPayees] =
      await Promise.all([
        listAccounts(),
        listTransactions(),
        listCategories(),
        getCurrency(),
        listSeries(),
        // Only for naming the Planned rows — a series stores its payee as an
        // id, and titling by bare type says nothing about what is due.
        listPayees(),
      ]);
    setAccounts(nextAccounts);
    setTransactions(nextTransactions);
    setCategories(nextCategories);
    setPayees(nextPayees);
    setCurrency(nextCurrency);
    setAllSeries(series.filter((s) => !s.archived));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // Updates local state immediately (so the pills/sheet feel instant) and
  // persists the change in the background via setAccountFilterSelection
  // (fire-and-forget, same shape as e.g. updateWidgetSummary() elsewhere in
  // the app) — every caller below (the pills' toggle/"All accounts", and the
  // filter sheet's Apply, which is also how its Reset button takes effect)
  // routes through this one function, so there is exactly one place that
  // writes the setting and it can never drift from what's on screen.
  const updateSelection = useCallback((next: Selection) => {
    setSelection(next);
    void setAccountFilterSelection(next);
  }, []);

  const range = useMemo(() => ({ start: sel.start, end: sel.end }), [sel]);

  const visibleAccounts = useMemo(
    () => accountsInScope(accounts, includeArchived),
    [accounts, includeArchived]
  );

  // §8.6: once the last archived account is unarchived, the toggle's render
  // gate goes false but `includeArchived` would otherwise stay stuck true —
  // harmless immediately (there's nothing archived to include), but it would
  // silently resurrect an already-on lens the moment anything is archived
  // again. Reset it whenever there's nothing archived left to show.
  useEffect(() => {
    if (includeArchived && !hasArchivedAccounts(accounts)) {
      setIncludeArchived(false);
    }
  }, [accounts, includeArchived, setIncludeArchived]);

  const allIds = useMemo(() => visibleAccounts.map((a) => a.id), [visibleAccounts]);
  const selIds = useMemo(
    () => new Set(effectiveIds(selection, allIds)),
    [selection, allIds]
  );
  const selectedAccounts = useMemo(
    () => visibleAccounts.filter((a) => selIds.has(a.id)),
    [visibleAccounts, selIds]
  );
  const selectedTxns = useMemo(
    () => transactions.filter((t) => selIds.has(t.accountId)),
    [transactions, selIds]
  );

  // Device clock for the "counted" cutoff (totals/breakdowns/cash-flow below)
  // — a future-dated transaction must not inflate any of these (docs/design/
  // future-dated-transactions-spec.md). Read directly here, at the UI
  // boundary, same as `PeriodSheet`'s own `now` — never inside src/domain.
  const now = Date.now();

  const totals = useMemo(
    () => totalsForRange(selectedTxns, range, now),
    [selectedTxns, range, now]
  );

  const categoriesById = useMemo(
    () => new Map(categories.map((c2) => [c2.id, c2])),
    [categories]
  );
  const payeesById = useMemo(() => new Map(payees.map((p) => [p.id, p])), [payees]);
  const expenseSlices = useMemo(
    () => categoryBreakdown(selectedTxns, range, 'expense', now),
    [selectedTxns, range, now]
  );
  const incomeSlices = useMemo(
    () => categoryBreakdown(selectedTxns, range, 'income', now),
    [selectedTxns, range, now]
  );
  const expenseLegend = useMemo(
    () => buildLegend(expenseSlices, categoriesById, c),
    [expenseSlices, categoriesById, c.muted]
  );
  const incomeLegend = useMemo(
    () => buildLegend(incomeSlices, categoriesById, c),
    [incomeSlices, categoriesById, c.muted]
  );
  // *Of variants (spec §5.4): selectedAccounts is already this screen's own
  // filtered scope (archive toggle + account-filter pills combined), so
  // these must sum EXACTLY that list rather than re-filtering `!archived`
  // internally — otherwise the headline net worth and the account rows
  // beneath it would disagree with `selectedTxns`-derived totals whenever
  // the archive toggle is on.
  // Balances are what has ACTUALLY happened: the counting clock is clamped to
  // now (settledBy), so selecting the current month no longer counts a charge
  // dated later this month. A past period is unaffected. Money that has not
  // moved yet lives in the ledger's Upcoming section and the forecast below.
  const periodAccounts = useMemo(
    () => periodBalancesOf(selectedAccounts, transactions, range, Date.now()),
    [selectedAccounts, transactions, range]
  );
  const netEnd = useMemo(
    () => netWorthOfAsOf(selectedAccounts, transactions, range.end - 1, Date.now()),
    [selectedAccounts, transactions, range]
  );

  const barGranularity = useMemo<Granularity>(
    () => (sel.mode === 'year' ? 'month' : 'day'),
    [sel.mode]
  );

  const cashFlow = useMemo(
    () => cashFlowSeries(selectedTxns, range, barGranularity, now),
    [selectedTxns, range, barGranularity, now]
  );

  const sampleTimes = useMemo(() => {
    const span = Math.max(1, range.end - 1 - range.start);
    return Array.from({ length: CHART_STEPS + 1 }, (_, i) =>
      range.start + Math.round((span * i) / CHART_STEPS)
    );
  }, [range]);

  const series = useMemo(
    () =>
      periodAccounts.map((p, i) => ({
        color: accountColor(i, c),
        values: balanceSeries(p.account, transactions, sampleTimes),
      })),
    [periodAccounts, transactions, sampleTimes]
  );

  // Drop the measured floor when the data behind the slides changes, so the
  // card can shrink again rather than keeping a height earned by data that is
  // no longer there.
  useEffect(() => {
    setSlideFloor(0);
  }, [series, cashFlow, expenseLegend, incomeLegend]);

  // Forecast net worth 30 days from now.
  // Only rendered when isAllSelected(selection) — the projected line is gated,
  // so a subset-scoped netEnd combined with all-account recurring series is never shown.
  const upcoming = useMemo(() => {
    const now = Date.now();
    const until = now + FORECAST_DAYS * 86_400_000;
    // Counts scheduled occurrences AND one-off future-dated rows — the latter
    // would otherwise appear nowhere, now that balances stop at today.
    return upcomingTotals(allSeries, transactions, now, until, currency);
  }, [allSeries, transactions, currency]);

  const forecastDelta = upcoming.net;

  // One row per active series, showing its NEXT upcoming occurrence (sorted by
  // soonest). Keeps the Planned list a 1:1 view of the user's recurring items
  // rather than expanding each series into multiple future dates.
  const plannedItems = useMemo(() => {
    const now = Date.now();
    const items: { key: string; series: RecurringSeries; date: number }[] = [];
    for (const s of allSeries) {
      if (s.paused) continue;
      const [next] = upcomingOccurrences(s, now, 1);
      if (next != null) {
        items.push({ key: s.id, series: s, date: next });
      }
    }
    return items.sort((a, b) => a.date - b.date).slice(0, PLANNED_LIMIT);
  }, [allSeries]);

  const netTone = totals.net < 0 ? 'text-negative' : 'text-positive';

  const fmtDate = (epoch: number) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      new Date(epoch),
    );

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12 }}>
        {/* top bar: period button (left) + actions (right) */}
        <View className="flex-row items-center justify-between mb-2">
          <Pressable
            onPress={() => setSheetOpen(true)}
            className="flex-row items-center bg-surfaceAlt border border-border rounded-pill px-3.5 py-2"
            accessibilityLabel="Change period"
          >
            <Feather name="calendar" size={14} color={c.muted} />
            <Text className="text-text text-[13px] font-bold ml-2">{sel.label}</Text>
            <Feather name="chevron-down" size={14} color={c.muted} style={{ marginLeft: 4 }} />
          </Pressable>
        </View>

        <Text className="text-text text-[28px] font-extrabold mb-3">Overview</Text>

        <AccountFilterPills
          accounts={visibleAccounts}
          selection={selection}
          onToggleAccount={(id) => updateSelection(toggleAccount(selection, id, allIds))}
          onSelectAll={() => updateSelection(selectAll())}
          onOpenPicker={() => setPickerOpen(true)}
        />

        {/* "Include archived" lens — same pill family as AccountFilterPills
            above, shared (session-scoped, unpersisted) with the Transactions
            tab via useIncludeArchived (spec §5.3/§5.3a). One shared component
            (IncludeArchivedToggle) so both screens render the identical
            control instead of two copies that could drift; it self-gates on
            hasArchivedAccounts. */}
        <IncludeArchivedToggle accounts={accounts} />

        {/* combined chart card — swipe left/right to switch views */}
        <View className="bg-surface border border-border rounded-lg mb-3">
          {/* always-visible header: dynamic chart title, + net worth only on
              the two financial pages (a net-worth figure under "Expenses by
              category" would misread as that page's own total). */}
          <View className="px-4 pt-4 pb-1">
            <Text className="text-muted text-xs font-semibold">
              {titleForChartPage(chartPage)} · {sel.label}
              {!isAllSelected(selection) ? ` · ${scopeLabel(selection, visibleAccounts)}` : ''}
            </Text>
            {/* Kept MOUNTED on every page and hidden on the category pages,
                rather than unmounted. The figure itself must not show under
                "Expenses by category" — it would misread as that page's own
                total — but removing it collapsed the card by the height of a
                26px figure plus two projection lines, so the card and
                everything beneath it jumped on every swipe. Reserving the
                space keeps one card height for all four pages.

                aria-hidden as well as invisible: a screen reader must not
                announce a net-worth figure the page is deliberately not
                claiming. */}
            <View
              style={{ opacity: chartPage < 2 ? 1 : 0 }}
              pointerEvents={chartPage < 2 ? 'auto' : 'none'}
              accessibilityElementsHidden={chartPage >= 2}
              importantForAccessibility={chartPage < 2 ? 'auto' : 'no-hide-descendants'}
            >
              <>
                <Text className="text-text text-[26px] font-extrabold mt-0.5">
                  {formatMoney(netEnd, currency)}
                </Text>
                {isAllSelected(selection) &&
                  (upcoming.incoming !== 0 || upcoming.outgoing !== 0) && (
                    <>
                      <Text className="text-muted text-[12px] mt-0.5">
                        Projected in {FORECAST_DAYS}d:{' '}
                        <Text
                          className={
                            forecastDelta >= 0 ? 'text-positive' : 'text-negative'
                          }
                        >
                          {forecastDelta >= 0 ? '+' : '−'}
                          {formatMoney(Math.abs(forecastDelta), currency)}
                        </Text>
                      </Text>
                      {/* Both directions, not just the net: "+900 / −1,240"
                          tells you what is actually coming, where a single
                          net figure hides an incoming salary behind an
                          outgoing rent. */}
                      <Text className="text-muted text-[11px] mt-0.5">
                        <Text className="text-positive">
                          +{formatMoney(upcoming.incoming, currency)}
                        </Text>
                        {'   '}
                        <Text className="text-negative">
                          −{formatMoney(upcoming.outgoing, currency)}
                        </Text>
                        {'  upcoming'}
                      </Text>
                    </>
                  )}
              </>
            </View>
          </View>

          {/* horizontally paged charts */}
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onMomentumScrollEnd={(e) =>
              setChartPage(Math.round(e.nativeEvent.contentOffset.x / slideWidth))
            }
          >
            {/* slide 0: account balance trend */}
            <View
              onLayout={onSlideLayout}
              style={{ width: slideWidth, minHeight: Math.max(slideFloor, SLIDE_MIN_HEIGHT), paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}
            >
              {series.length > 0 ? (
                <>
                  <MultiLineChart series={series} width={contentWidth} height={chartHeight} />
                  <View className="flex-row flex-wrap mt-2" style={{ gap: 10 }}>
                    {periodAccounts.map((p, i) => (
                      <View key={p.account.id} className="flex-row items-center" style={{ gap: 5 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: accountColor(i, c) }} />
                        <Text className="text-muted text-[10px]">
                          {p.account.name}
                          {p.account.archived ? ' · Archived' : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text className="text-muted text-xs text-center py-8">No accounts yet.</Text>
              )}
            </View>

            {/* slide 1: income vs expense cash flow */}
            <View
              onLayout={onSlideLayout}
              style={{ width: slideWidth, minHeight: Math.max(slideFloor, SLIDE_MIN_HEIGHT), paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}
            >
              {cashFlow.length > 1 ? (
                <>
                  <BarChart data={cashFlow} width={contentWidth} height={chartHeight} />
                  <View className="flex-row mt-2" style={{ gap: 14 }}>
                    <View className="flex-row items-center" style={{ gap: 5 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.positive }} />
                      <Text className="text-muted text-[10px]">Income</Text>
                    </View>
                    <View className="flex-row items-center" style={{ gap: 5 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.negative }} />
                      <Text className="text-muted text-[10px]">Expenses</Text>
                    </View>
                  </View>
                </>
              ) : (
                <Text className="text-muted text-xs text-center py-8">No transactions this period.</Text>
              )}
            </View>

            {/* slide 2: expenses by category */}
            <View
              onLayout={onSlideLayout}
              style={{ width: slideWidth, minHeight: Math.max(slideFloor, SLIDE_MIN_HEIGHT), paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}
            >
              <CategoryDonutRow
                label="Expenses"
                legend={expenseLegend}
                currency={currency}
                emptyLabel="No expenses this period."
              />
            </View>

            {/* slide 3: income by category */}
            <View
              onLayout={onSlideLayout}
              style={{ width: slideWidth, minHeight: Math.max(slideFloor, SLIDE_MIN_HEIGHT), paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}
            >
              <CategoryDonutRow
                label="Income"
                legend={incomeLegend}
                currency={currency}
                emptyLabel="No income this period."
              />
            </View>
          </ScrollView>

          {/* page dots */}
          <View className="flex-row justify-center pb-3 pt-1" style={{ gap: 5 }}>
            {Array.from({ length: CHART_PAGE_COUNT }).map((_, i) => (
              <View
                key={i}
                style={{
                  width: i === chartPage ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i === chartPage ? c.primary : c.border,
                }}
              />
            ))}
          </View>
        </View>

        {/* income / expense stat tiles */}
        {/* Income / Expense stat tiles, each with a per-bucket sparkline from
            the same cashFlow series the Cash-flow chart page uses (period- and
            account-filter-scoped, so tile number and tile shape always agree).
            floor=0: these are magnitudes — normalizing to the series min would
            exaggerate noise. Hidden (null) when the period has <2 buckets. */}
        <View className="flex-row mb-2.5" style={{ gap: 8 }}>
          <View className="flex-1 bg-surface border border-border rounded-md px-3 py-2.5">
            <Text className="text-muted text-[9px] font-bold uppercase tracking-wide">Income</Text>
            <Text className="text-positive text-base font-extrabold mt-0.5">
              +{formatMoney(totals.income, currency)}
            </Text>
            <View className="mt-1.5">
              <Sparkline
                values={cashFlow.map((b) => b.income)}
                color={c.positive}
                height={30}
                floor={0}
              />
            </View>
          </View>
          <View className="flex-1 bg-surface border border-border rounded-md px-3 py-2.5">
            <Text className="text-muted text-[9px] font-bold uppercase tracking-wide">Expense</Text>
            <Text className="text-negative text-base font-extrabold mt-0.5">
              −{formatMoney(totals.expense, currency)}
            </Text>
            <View className="mt-1.5">
              <Sparkline
                values={cashFlow.map((b) => b.expense)}
                color={c.negative}
                height={30}
                floor={0}
              />
            </View>
          </View>
        </View>

        {/* net savings / spending */}
        <View className="bg-surfaceBlue border border-borderAccent rounded-lg px-4 py-3 mb-4">
          <Text className="text-muted text-[9px] font-bold uppercase tracking-wide">
            {totals.net < 0 ? 'Net spending' : 'Net savings'}
          </Text>
          <Text className={`text-[22px] font-extrabold mt-0.5 ${netTone}`}>
            {totals.net < 0 ? '−' : '+'}
            {formatMoney(Math.abs(totals.net), currency)}
          </Text>
        </View>

        {/* Planned recurring transactions */}
        {plannedItems.length > 0 && (
          <View className="mb-4">
            <View className="flex-row items-center justify-between mx-1 mb-2.5">
              <Text className="text-muted text-xs font-bold uppercase tracking-wide">
                Planned
              </Text>
              <Pressable
                onPress={() => router.push('/recurring')}
                className="flex-row items-center"
                style={{ gap: 4 }}
                accessibilityLabel="Manage recurring transactions"
              >
                <Text className="text-primary text-[12px] font-semibold">Manage</Text>
                <Feather name="chevron-right" size={12} color={c.primary} />
              </Pressable>
            </View>
            {plannedItems.map((item) => {
              const { series, date } = item;
              const signed =
                series.template.type === 'income'
                  ? series.template.amount
                  : -series.template.amount;
              const iconBg =
                series.template.type === 'income'
                  ? 'bg-chipIncome'
                  : series.template.type === 'transfer'
                    ? 'bg-chipTransfer'
                    : 'bg-chipExpense';
              return (
                <View
                  key={item.key}
                  className="flex-row items-center gap-3 bg-surface rounded-md p-3.5 mb-2 opacity-70"
                  style={{ borderWidth: 1, borderColor: c.border + '80' }}
                >
                  <View className={`w-10 h-10 rounded-xl items-center justify-center ${iconBg}`}>
                    <Text className="text-lg">🔁</Text>
                  </View>
                  <View className="flex-1">
                    {/* Named like the ledger names the same series' rows.
                        This was the THIRD surface titling by bare type — the
                        earlier fix covered Transactions and Recurring and
                        missed this one, which is where it was noticed. */}
                    <Text className="text-text text-sm font-semibold" numberOfLines={1}>
                      {seriesTitle(series.template, {
                        payeeName: series.template.payeeId
                          ? payeesById.get(series.template.payeeId)?.name
                          : undefined,
                        categoryName: series.template.categoryId
                          ? categoriesById.get(series.template.categoryId)?.name
                          : undefined,
                      })}
                    </Text>
                    <Text className="text-muted text-xs mt-0.5">{fmtDate(date)}</Text>
                  </View>
                  <Text
                    className={`text-[15px] font-bold ${
                      series.template.type === 'transfer'
                        ? 'text-muted'
                        : signed >= 0
                          ? 'text-positive'
                          : 'text-negative'
                    }`}
                  >
                    {formatMoney(signed, series.template.currency)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* accounts as of period */}
        {periodAccounts.length === 0 ? (
          <Text className="text-muted text-sm">
            No accounts yet — add one from Settings → Manage accounts.
          </Text>
        ) : (
          <>
            <Text className="text-muted text-xs font-bold uppercase tracking-wide mx-1 mb-2.5">
              Accounts · {selectedAccounts.length} shown — as of {sel.label}
            </Text>
            {periodAccounts.map((p) => {
              const { emoji, bg } = accountIcon(p.account);
              const meta = [p.account.subtype, p.account.tag, p.account.archived ? 'Archived' : null]
                .filter(Boolean)
                .join(' · ');
              const chgTone =
                p.change === 0 ? 'text-muted' : p.change < 0 ? 'text-negative' : 'text-positive';
              return (
                <Pressable
                  key={p.account.id}
                  onPress={() =>
                    router.push({
                      pathname: '/account/[id]',
                      params: {
                        id: p.account.id,
                        start: String(sel.start),
                        end: String(sel.end),
                        label: sel.label,
                      },
                    })
                  }
                  className="flex-row items-center gap-3 bg-surface border border-border rounded-md px-3.5 py-3 mb-2.5"
                >
                  {/* No series-colour dot here: the chart directly above has
                      its own legend carrying the same swatch and name, so a
                      second key on every row was redundant. */}
                  <View className={`w-10 h-10 rounded-xl items-center justify-center ${bg}`}>
                    <Text className="text-lg">{emoji}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-text text-sm font-semibold">{p.account.name}</Text>
                    {meta ? <Text className="text-muted text-xs mt-0.5">{meta}</Text> : null}
                  </View>
                  <View className="items-end">
                    <Text
                      className={`text-[15px] font-extrabold ${p.close < 0 ? 'text-negative' : 'text-text'}`}
                    >
                      {formatMoney(p.close, currency)}
                    </Text>
                    <Text className={`text-[10px] mt-0.5 ${chgTone}`}>
                      {p.change === 0
                        ? 'no change'
                        : `${p.change < 0 ? '−' : '+'}${formatMoney(Math.abs(p.change), currency)}`}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

        {/* Manage recurring shortcut (when there are no planned items but series exist) */}
        {allSeries.length > 0 && plannedItems.length === 0 && (
          <Pressable
            onPress={() => router.push('/recurring')}
            className="flex-row items-center justify-between bg-surface border border-border rounded-md px-4 py-3 mb-2"
          >
            <View className="flex-row items-center" style={{ gap: 10 }}>
              <Text className="text-lg">🔁</Text>
              <Text className="text-text text-sm font-semibold">Recurring transactions</Text>
            </View>
            <Feather name="chevron-right" size={16} color={c.muted} />
          </Pressable>
        )}
      </ScrollView>

      <PeriodSheet
        visible={sheetOpen}
        initialMode={sel.mode}
        transactions={transactions}
        currency={currency}
        onSelect={(next) => {
          setSel(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />

      <AccountFilterSheet
        visible={pickerOpen}
        accounts={visibleAccounts}
        selection={selection}
        onApply={(next) => {
          updateSelection(next);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

/** One donut + legend for a single transaction type (expense or income), used
 *  by the "Expenses by category" and "Income by category" carousel slides
 *  above. */
function CategoryDonutRow({
  label,
  legend,
  currency,
  emptyLabel,
}: {
  label: string;
  legend: LegendItem[];
  currency: string;
  emptyLabel: string;
}) {
  if (legend.length === 0) {
    return (
      <View>
        <Text className="text-text text-xs font-bold mb-2">{label}</Text>
        <Text className="text-muted text-xs text-center py-4">{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <View>
      <Text className="text-text text-xs font-bold mb-2.5">{label}</Text>
      <View className="flex-row items-center" style={{ gap: 16 }}>
        <DonutChart
          slices={legend.map((item) => ({ value: item.amount, color: item.color }))}
          size={DONUT_SIZE}
          strokeWidth={16}
        />
        <View className="flex-1" style={{ gap: 6 }}>
          {legend.map((item) => (
            <View key={item.key} className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1" style={{ gap: 6 }}>
                <View
                  style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: item.color }}
                />
                <Text className="text-text text-[11px] flex-1" numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
              <Text className="text-muted text-[11px] font-semibold ml-2">
                {formatMoney(item.amount, currency)}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
