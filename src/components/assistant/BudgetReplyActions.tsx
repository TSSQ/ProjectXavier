/**
 * What renders under a budget answer (docs/design/monthly-budgets-spec.md §6):
 * the afford card with its buttons, the "which budget?" chips, the
 * set-budget confirm, the setup / open-Budget prompts, and the saved-expense
 * card with its chip. Pure presentation over `useBudgetReplies`.
 */
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AffordCard } from './AffordCard';
import { SetBudgetCard } from './SetBudgetCard';
import { SavedBudgetCard } from './SavedBudgetCard';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { TextAction } from '../ui/TextAction';
import { BudgetEditSheet } from '../budgets/BudgetEditSheet';
import { useThemeColors } from '../../theme/useThemeColors';
import { formatBudgetMoney } from '../../domain/budgetCopy';
import { monthKeyOf } from '../../domain/budgets';
import type { useBudgetReplies } from '../../features/budgets/useBudgetReplies';

type Replies = ReturnType<typeof useBudgetReplies>;

export function BudgetReplyActions({
  replies,
  currency,
  now,
  busy,
  onOpenBudget,
}: {
  replies: Replies;
  currency: string;
  now: number;
  busy: boolean;
  /** Pushes the Budget screen. */
  onOpenBudget: () => void;
}) {
  const c = useThemeColors();
  const { reply, saved } = replies;
  return (
    <>
      {reply && (
        <View style={{ paddingBottom: 8, gap: 8 }}>
          {reply.kind === 'afford' && (
            <>
              <AffordCard plan={reply.plan} summary={reply.summary} currency={currency} now={now} />
              <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
                {reply.plan.result.verdict === 'over' && reply.plan.view && (
                  <Button
                    title={`Raise ${reply.plan.categoryName} budget`}
                    variant="ghost"
                    className="px-4"
                    onPress={replies.onRaise}
                    accessibilityLabel={`Raise ${reply.plan.categoryName} budget`}
                  />
                )}
                <Button
                  title={
                    reply.plan.result.verdict === 'fits'
                      ? `Log it · ${formatBudgetMoney(reply.plan.amount, currency)}`
                      : 'Log it'
                  }
                  variant={reply.plan.result.verdict === 'fits' ? 'primary' : 'ghost'}
                  className="px-4"
                  onPress={replies.onLog}
                  accessibilityLabel="Log it"
                />
                <TextAction label="Not now" onPress={replies.onDismiss} />
              </View>
            </>
          )}

          {reply.kind === 'afford-pick' && (
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {reply.options.map((o) => (
                <Chip
                  key={o.categoryId}
                  label={`${o.icon ?? '🏷️'} ${o.name}`}
                  surface="canvas"
                  onPress={() => replies.onPick(o.categoryId)}
                  accessibilityLabel={`Answer from ${o.name}`}
                />
              ))}
              <Chip
                label="All budgets"
                surface="canvas"
                onPress={() => replies.onPick('all')}
                accessibilityLabel="Answer from all budgets"
              />
            </View>
          )}

          {reply.kind === 'no-budgets' && (
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Button
                title="Set up budgets"
                className="px-4"
                onPress={() => {
                  replies.onDismiss();
                  onOpenBudget();
                }}
                accessibilityLabel="Set up budgets"
              />
              <TextAction label="Not now" onPress={replies.onDismiss} />
            </View>
          )}

          {reply.kind === 'budget-unknown' && (
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Button
                title="Open Budget"
                className="px-4"
                onPress={() => {
                  replies.onDismiss();
                  onOpenBudget();
                }}
                accessibilityLabel="Open Budget"
              />
              <TextAction label="Dismiss" onPress={replies.onDismiss} />
            </View>
          )}

          {reply.kind === 'set-budget-suggest' && (
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Button
                title={`Yes, ${reply.category.name}`}
                className="px-4"
                onPress={replies.onSuggestionYes}
                accessibilityLabel={`Use ${reply.category.name}`}
              />
              <TextAction label="Cancel" onPress={replies.onDismiss} />
            </View>
          )}

          {reply.kind === 'set-budget' && (
            <>
              <SetBudgetCard
                icon={reply.category.icon ?? null}
                name={reply.category.name}
                current={reply.current}
                next={reply.next}
                month={reply.month}
                currency={currency}
              />
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <Button
                  title="Confirm"
                  glow
                  className="px-5"
                  onPress={replies.onConfirmSetBudget}
                  accessibilityLabel="Confirm budget"
                />
                <TextAction label="Cancel" onPress={replies.onDismiss} />
              </View>
            </>
          )}
          {busy && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
        </View>
      )}

      {saved && (
        <View style={{ paddingBottom: 8 }}>
          <SavedBudgetCard
            title={saved.title}
            amountText={saved.amountText}
            meta={saved.meta}
            chip={saved.chip}
          />
        </View>
      )}

      {/* "Raise <category> budget" from an over-budget afford answer. */}
      <BudgetEditSheet
        visible={replies.edit !== null}
        target={replies.edit?.target ?? null}
        month={replies.edit?.month ?? monthKeyOf(now)}
        currency={currency}
        onClose={replies.closeEdit}
        onSave={replies.onEditSave}
      />
    </>
  );
}
