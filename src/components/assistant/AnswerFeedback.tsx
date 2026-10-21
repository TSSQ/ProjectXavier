/**
 * "Wrong answer" on a live Ask-Xavier card (src/domain/queryFeedback.ts).
 * A link that opens three rows of chips — the right tool, the right period
 * (or "Other"), the right category / payee from the user's own lists (or
 * none) — and a button that re-runs the corrected call. Everything a chip
 * starts as is what already ran, so changing only the period is one tap
 * plus the button. Live cards only: history cards get no feedback.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Chip } from '../ui/Chip';
import { Button } from '../ui/Button';
import { useScaledType } from '../../theme/useScaledType';
import { Category, Payee } from '../../domain/types';
import { QueryToolCall, QueryToolName } from '../../domain/queryTools';
import { FilterResolution, filtersOfResult } from '../../domain/queryFilterResolution';
import {
  FEEDBACK_PERIODS,
  FEEDBACK_PERIOD_LABELS,
  FEEDBACK_TOOLS,
  FeedbackFilter,
  FeedbackPeriod,
  QUERY_TOOL_LABELS,
  QueryFeedbackChoice,
  callPeriod,
  periodToken,
  toolCategoryKind,
  toolFilters,
} from '../../domain/queryFeedback';

/** At most this many of each list are offered as chips. */
const MAX_ENTITY_CHIPS = 30;

export interface AnswerFeedbackProps {
  call: QueryToolCall;
  result: unknown;
  categories: readonly Category[];
  payees: readonly Payee[];
  busy?: boolean;
  onSubmit: (choice: QueryFeedbackChoice) => void;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** The filter that ran, when it was one entity. */
function appliedFilter(filters: FilterResolution[]): FeedbackFilter | null {
  for (const f of filters) {
    if ((f.dim === 'category' || f.dim === 'payee') && f.ids.length >= 1 && f.names.length === 1) {
      return { dim: f.dim, id: f.ids[0]!, name: f.names[0]! };
    }
  }
  return null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const s = useScaledType();
  return (
    <View style={{ gap: 6 }}>
      <Text className="text-muted" style={{ fontSize: s.role.caption }}>
        {label}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {children}
      </ScrollView>
    </View>
  );
}

export function AnswerFeedback({ call, result, categories, payees, busy, onSubmit }: AnswerFeedbackProps) {
  const s = useScaledType();
  const [open, setOpen] = useState(false);
  const applied = useMemo(() => appliedFilter(filtersOfResult(result)), [result]);
  const [tool, setTool] = useState<QueryToolName>(call.tool);
  const [period, setPeriod] = useState<FeedbackPeriod | null>(periodToken(callPeriod(call)));
  const [filter, setFilter] = useState<FeedbackFilter | null>(applied);
  const [filterTouched, setFilterTouched] = useState(false);

  const kind = toolCategoryKind(tool);
  const takes = toolFilters(tool);
  // The first MAX_ENTITY_CHIPS by name, plus the one that ran if it is not
  // among them, so what ran always shows as selected.
  const withApplied = <T extends { id: string; name: string }>(all: readonly T[], dim: 'category' | 'payee') => {
    const shown = all.slice().sort(byName).slice(0, MAX_ENTITY_CHIPS);
    const ran = applied?.dim === dim ? all.find((e) => e.id === applied.id) : undefined;
    return ran && !shown.includes(ran) ? [ran, ...shown] : shown;
  };
  const cats = withApplied(
    categories.filter((c) => (kind === 'any' ? c.kind !== 'transfer' : c.kind === kind)),
    'category'
  );
  const pays = withApplied(payees, 'payee');

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Wrong answer"
        hitSlop={8}
        className="self-start px-1"
      >
        <Text className="text-primary font-semibold" style={{ fontSize: s.role.caption }}>
          Wrong answer?
        </Text>
      </Pressable>
    );
  }

  const pickFilter = (next: FeedbackFilter) => {
    setFilter(next);
    setFilterTouched(true);
  };
  const submit = () => {
    const choice: QueryFeedbackChoice = {
      ...(tool !== call.tool ? { tool } : {}),
      ...(period && period !== periodToken(callPeriod(call)) ? { period } : {}),
      // A picked filter the chosen tool cannot take is not sent.
      ...(filterTouched && filter && takes.includes(filter.dim) ? { filter } : {}),
    };
    onSubmit(choice);
    setOpen(false);
  };
  const isFilter = (dim: 'category' | 'payee', id: string | null) =>
    filter ? filter.dim === dim && filter.id === id : id === null;

  return (
    <View className="px-1" style={{ gap: 10 }}>
      <Text className="text-text font-semibold" style={{ fontSize: s.role.caption }}>
        What should I have answered?
      </Text>
      <Row label="Answer">
        {FEEDBACK_TOOLS.map((t) => (
          <Chip key={t} label={QUERY_TOOL_LABELS[t]} surface="content" selected={tool === t} onPress={() => setTool(t)} />
        ))}
      </Row>
      <Row label="Period">
        {FEEDBACK_PERIODS.map((p) => (
          <Chip
            key={p}
            label={FEEDBACK_PERIOD_LABELS[p]}
            surface="content"
            selected={period === p}
            onPress={() => setPeriod(p)}
          />
        ))}
      </Row>
      {takes.length ? (
        <Row label={takes.includes('payee') ? 'Category or payee' : 'Category'}>
          <Chip
            label="None"
            surface="content"
            selected={isFilter('category', null)}
            onPress={() => pickFilter({ dim: 'category', id: null, name: null })}
          />
          {cats.map((c) => (
            <Chip
              key={`c-${c.id}`}
              label={c.name}
              surface="content"
              selected={isFilter('category', c.id)}
              onPress={() => pickFilter({ dim: 'category', id: c.id, name: c.name })}
            />
          ))}
          {takes.includes('payee')
            ? pays.map((p) => (
                <Chip
                  key={`p-${p.id}`}
                  label={p.name}
                  leading="user"
                  surface="content"
                  selected={isFilter('payee', p.id)}
                  onPress={() => pickFilter({ dim: 'payee', id: p.id, name: p.name })}
                />
              ))
            : null}
        </Row>
      ) : null}
      <View className="flex-row" style={{ gap: 10 }}>
        <Button title="Show corrected answer" onPress={submit} disabled={busy} loading={busy} />
        <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} disabled={busy} />
      </View>
    </View>
  );
}
