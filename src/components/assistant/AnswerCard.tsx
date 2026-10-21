/**
 * Ask-Xavier answer card dispatcher (docs/design/ask-xavier-queries-spec.md
 * §5.4) — picks the right card for a tool result and renders the caption
 * underneath it. The caption is ALWAYS secondary/smaller than the card: for
 * BYOK it's the model's own narration (display-only prose — never a source
 * of any number); for FM/floor it's a deterministic, model-free template
 * built from the tool result itself (spec: "FM/floor answers get a
 * deterministic one-line caption template — no model prose at all").
 *
 * `result` is typed `unknown` at this boundary because it travels through
 * `QueryLoopResult`/the FM selection path as opaque tool output — but it was
 * PRODUCED by this app's own pure executors (`src/domain/queryTools.ts`),
 * never by a model, so casting to each tool's own result shape here is safe
 * (unlike casting untrusted model JSON, which always goes through zod first).
 *
 * Filters (src/domain/queryFilterResolution.ts): when a category/payee/account
 * word resolved by anything looser than an exact name, the card says what it
 * included ("Included Dining + Groceries for "food".") and — on the live card
 * only (`onFilterChip` set) — offers chips: "did you mean" alternatives,
 * "Just <X>" for a union, "Not <X>" to revert a remembered reading.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Chip } from '../ui/Chip';
import { useScaledType } from '../../theme/useScaledType';
import { StatCard } from './StatCard';
import { BreakdownCard } from './BreakdownCard';
import { TrendCard } from './TrendCard';
import { RankListCard } from './RankListCard';
import { TxListCard } from './TxListCard';
import {
  QueryToolName,
  TotalSpentResult,
  TotalIncomeResult,
  SpendingByCategoryResult,
  SpendingOverTimeResult,
  TopPayeesResult,
  NetWorthResult,
  SearchTransactionsResult,
} from '../../domain/queryTools';
import { FilterChipAction, explainFilter, filtersOfResult } from '../../domain/queryFilterResolution';
import { AnswerFeedback, AnswerFeedbackProps } from './AnswerFeedback';

export interface QueryAnswer {
  tool: QueryToolName;
  result: unknown;
  currency: string;
  /** Secondary caption under the card — BYOK narration, or a deterministic
   *  template for FM/floor. Null renders no caption at all. */
  caption: string | null;
  /** Live card only: a filter chip was tapped. Absent → no chips (history). */
  onFilterChip?: (action: FilterChipAction) => void;
  /** Chips are disabled while a re-run is in flight. */
  busy?: boolean;
  /** Live card only: the "Wrong answer" panel. */
  feedback?: AnswerFeedbackProps;
}

function notesOf(result: unknown): string[] {
  const notes = (result as { notes?: unknown } | null)?.notes;
  return Array.isArray(notes) ? notes.filter((n): n is string => typeof n === 'string') : [];
}

function CardBody({ tool, result, currency }: { tool: QueryToolName; result: unknown; currency: string }) {
  switch (tool) {
    case 'total_spent': {
      const r = result as TotalSpentResult;
      return <StatCard label="Total spent" amountMinor={r.amountMinor} currency={currency} tone="negative" />;
    }
    case 'total_income': {
      const r = result as TotalIncomeResult;
      return <StatCard label="Total income" amountMinor={r.amountMinor} currency={currency} tone="positive" />;
    }
    case 'spending_by_category': {
      const r = result as SpendingByCategoryResult;
      return <BreakdownCard slices={r.slices} currency={currency} />;
    }
    case 'spending_over_time': {
      const r = result as SpendingOverTimeResult;
      return <TrendCard series={r.series} currency={currency} tone="negative" />;
    }
    case 'top_payees': {
      const r = result as TopPayeesResult;
      return <RankListCard rows={r.rows} currency={currency} />;
    }
    case 'net_worth': {
      const r = result as NetWorthResult;
      if (r.series) return <TrendCard series={r.series} currency={currency} tone="positive" />;
      return (
        <StatCard
          label="Net worth"
          amountMinor={r.amountMinor ?? 0}
          currency={currency}
          tone={((r.amountMinor ?? 0) >= 0 ? 'positive' : 'negative') as 'positive' | 'negative'}
        />
      );
    }
    case 'search_transactions': {
      const r = result as SearchTransactionsResult;
      return <TxListCard rows={r.rows} currency={currency} />;
    }
    default:
      return null;
  }
}

function FilterNotes({
  result,
  onFilterChip,
  busy,
}: {
  result: unknown;
  onFilterChip?: (action: FilterChipAction) => void;
  busy?: boolean;
}) {
  const s = useScaledType();
  const explained = filtersOfResult(result)
    .map((f) => explainFilter(f, !!onFilterChip))
    .filter((e) => e.line || (onFilterChip && e.chips.length));
  if (!explained.length) return null;
  return (
    <>
      {explained.map((e, i) => (
        <View key={i} style={{ gap: 6 }} className="px-1">
          {e.line ? (
            <Text className="text-muted" style={{ fontSize: s.role.caption }}>
              {e.line}
            </Text>
          ) : null}
          {onFilterChip && e.chips.length ? (
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {e.chips.map((chip, j) => (
                <Chip
                  key={`${j}-${chip.label}`}
                  label={chip.label}
                  surface="content"
                  disabled={busy}
                  onPress={() => onFilterChip(chip.action)}
                  accessibilityLabel={chip.label}
                />
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </>
  );
}

export function AnswerCard({ tool, result, currency, caption, onFilterChip, busy, feedback }: QueryAnswer) {
  const notes = notesOf(result);
  return (
    <View style={{ gap: 6 }}>
      <CardBody tool={tool} result={result} currency={currency} />
      <FilterNotes result={result} onFilterChip={onFilterChip} busy={busy} />
      {notes.map((note, i) => (
        <Text key={i} className="text-muted text-[11px] px-1">
          {note}
        </Text>
      ))}
      {caption ? <Text className="text-muted text-xs px-1">{caption}</Text> : null}
      {feedback ? <AnswerFeedback {...feedback} /> : null}
    </View>
  );
}
