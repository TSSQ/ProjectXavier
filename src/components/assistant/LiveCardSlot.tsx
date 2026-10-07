import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';
import { TransactionDraft } from '../../domain/assistant';
import { AccountFlowState, ReadyAccount } from '../../domain/accountAssistant';
import { QueryToolName } from '../../domain/queryTools';
import { QueryComparison } from '../../domain/queryComparison';
import { AnswerCard } from './AnswerCard';
import { ComparisonCard } from './ComparisonCard';
import { AccountUpdateDraft } from '../../domain/accountUpdateAssistant';
import { useBudgetReplies, BudgetReply } from '../../features/budgets/useBudgetReplies';
import type { ComponentProps } from 'react';
import type { LiveCard } from '../../domain/liveCard';
import type { Tail } from '../../domain/chatFeed';
import { BudgetReplyActions } from './BudgetReplyActions';
import { DraftCard } from './DraftCard';
import { AccountDraftCard, AccountUpdateDraftCard, DeleteHandoffActions, FmRefusalActions, AccountFlowProgress, SubtypeChoiceChips } from './AccountCards';
import { TransactionOpPicker, TxOpState } from './TransactionOpPicker';

export type PendingAccountUpdate = AccountUpdateDraft & { accountId: string; currentName: string };
export type DeleteHandoffState = { accountId: string; accountName: string; deepLink: string };
export type QueryAnswerState = {
  tool: QueryToolName;
  result: unknown;
  caption: string | null;
  // BYOK multi-call comparison (docs/design/ask-xavier-queries-spec.md §5.4,
  // device bug build 58) — set only when `buildQueryComparison` recognised a
  // genuine same-tool, different-period, single-scalar-amount comparison; the
  // card renders this INSTEAD of `tool`/`result` when present.
  comparison: QueryComparison | null;
};
/** The tx picker flow: the picker itself, its "which account?" step, or the update editor. */
export type TxPickerLive = { txOp: TxOpState | null; phase: 'picker' | 'choosing_account' | 'editing' };
/** What each card flow holds on the screen (see `liveCardOf`). */
export interface ScreenValues {
  draft: TransactionDraft;
  account_create: ReadyAccount;
  account_update: PendingAccountUpdate;
  delete_handoff: DeleteHandoffState;
  query_answer: QueryAnswerState;
  tx_picker: TxPickerLive;
  budget: BudgetReply;
}

// ─── the live card and the tail ─────────────────────────────────────────────

/** The handlers and shared data each live card flow needs, by flow. */
export interface LiveHandlers {
  draft: Omit<ComponentProps<typeof DraftCard>, 'draft'> & {
    queueProgress: { fraction: number; label: string } | null;
    onStopReviewing: () => void;
  };
  accountCreate: Omit<ComponentProps<typeof AccountDraftCard>, 'account'>;
  accountUpdate: Omit<ComponentProps<typeof AccountUpdateDraftCard>, 'draft'>;
  deleteHandoff: Omit<ComponentProps<typeof DeleteHandoffActions>, 'accountName'>;
  queryAnswer: { currency: string; onClear: () => void };
  txPicker: Omit<ComponentProps<typeof TransactionOpPicker>, 'txOp'>;
  budget: { replies: ReturnType<typeof useBudgetReplies>; currency: string; busy: boolean; onOpenBudget: () => void };
  busy: boolean;
}

/**
 * Draws THE live card. One discriminated union in, one card out: the
 * one-live-card rule is structural, because nothing here can draw two.
 */
export function LiveCardSlot({ card, h }: { card: LiveCard<ScreenValues>; h: LiveHandlers }) {
  const c = useThemeColors();
  const s = useScaledType();
  const body = (() => {
    switch (card.kind) {
      case 'draft': {
        const { queueProgress, onStopReviewing, ...draftProps } = h.draft;
        return (
          <>
            {/* While a statement-scan queue is active a progress bar sits above
                the card and Discard relabels to Skip (statement-scan-spec §4.4).
                `controlRaised`, not `wellRecessed`: this track has no `surface`
                ancestor and would go invisible. */}
            {queueProgress && (
              <View style={{ marginBottom: 8 }}>
                <View className="rounded-pill bg-controlRaised overflow-hidden" style={{ height: 4 }}>
                  <View
                    className="rounded-pill bg-primary"
                    style={{ height: 4, width: `${Math.round(queueProgress.fraction * 100)}%` }}
                  />
                </View>
                <Text className="text-muted mt-1" style={{ fontSize: s.role.caption }}>
                  {queueProgress.label}
                </Text>
              </View>
            )}
            <DraftCard draft={card.value} {...draftProps} />
            {queueProgress && (
              <Pressable
                onPress={onStopReviewing}
                disabled={h.busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: h.busy }}
                className="self-center mt-3 justify-center"
                style={{ opacity: h.busy ? 0.5 : 1, minHeight: 44 }}
                hitSlop={8}
              >
                <Text className="text-muted underline" style={{ fontSize: s.role.control }}>
                  Stop reviewing
                </Text>
              </Pressable>
            )}
          </>
        );
      }
      case 'account_create':
        // Editable before Create (account-chat-creation-spec §5.4).
        return <AccountDraftCard account={card.value} {...h.accountCreate} />;
      case 'account_update':
        // Pre-filled from the resolved target + change (account-chat-crud-spec §5.2).
        return <AccountUpdateDraftCard draft={card.value} {...h.accountUpdate} />;
      case 'delete_handoff':
        // Offers "Open in Accounts" and "Archive instead"; never deletes itself (§5.3).
        return <DeleteHandoffActions accountName={card.value.accountName} {...h.deleteHandoff} />;
      case 'query_answer': {
        const a = card.value;
        return (
          <>
            {/* Clear lives at the BLOCK level so comparisons are clearable too. */}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Pressable
                onPress={h.queryAnswer.onClear}
                accessibilityRole="button"
                accessibilityLabel="Clear answer"
                hitSlop={10}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 8 }}
              >
                <Feather name="x" size={13} color={c.muted} />
                <Text className="text-muted" style={{ fontSize: s.role.caption }}>
                  Clear
                </Text>
              </Pressable>
            </View>
            {a.comparison ? (
              <View style={{ gap: 6 }}>
                <ComparisonCard comparison={a.comparison} currency={h.queryAnswer.currency} />
                {a.caption ? (
                  <Text className="text-muted px-1" style={{ fontSize: s.role.caption }}>
                    {a.caption}
                  </Text>
                ) : null}
              </View>
            ) : (
              <AnswerCard tool={a.tool} result={a.result} currency={h.queryAnswer.currency} caption={a.caption} />
            )}
          </>
        );
      }
      case 'tx_picker':
        // The picker is its own card only while it is the step on screen: while
        // the "which account?" sheet or the update editor is open, the flow is
        // still live (never its abandoned stub) but has nothing to draw here.
        if (card.value.phase === 'choosing_account') {
          return (
            <Text className="text-muted" style={{ fontSize: s.role.caption }}>
              Choosing an account…
            </Text>
          );
        }
        return card.value.txOp && card.value.phase === 'picker' ? (
          <TransactionOpPicker txOp={card.value.txOp} {...h.txPicker} />
        ) : null;
      case 'budget':
        return (
          <BudgetReplyActions
            replies={h.budget.replies}
            currency={h.budget.currency}
            now={Date.now()}
            busy={h.budget.busy}
            onOpenBudget={h.budget.onOpenBudget}
          />
        );
    }
  })();
  return (
    <View style={{ paddingBottom: 8 }}>
      {body}
      {/* Budget cards draw their own progress. */}
      {h.busy && card.kind !== 'budget' && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
    </View>
  );
}

/** What hangs under the newest message: thinking, Q&A progress and chips, the
 *  FM-refusal card, and the Open Budget / no-budgets replies. Never stored. */
export function FeedTail({
  tail,
  accountFlow,
  onCancelAccount,
  onChooseSubtype,
  onLogAnyway,
  onDismissFmRefusal,
  busy,
  budget,
}: {
  tail: Tail;
  accountFlow: AccountFlowState | null;
  onCancelAccount: () => void;
  onChooseSubtype: (answer: string) => void;
  onLogAnyway: () => void;
  onDismissFmRefusal: () => void;
  busy: boolean;
  budget: LiveHandlers['budget'];
}) {
  const c = useThemeColors();
  return (
    <View style={{ gap: 8, paddingTop: 8 }}>
      {tail.accountProgress && accountFlow && (
        <AccountFlowProgress step={accountFlow.step} onCancel={onCancelAccount} />
      )}
      {tail.subtypeChips && <SubtypeChoiceChips onChoose={onChooseSubtype} />}
      {tail.thinking && <ActivityIndicator color={c.primary} style={{ alignSelf: 'flex-start', marginTop: 4 }} />}
      {tail.fmRefusal && (
        <>
          <FmRefusalActions onLogAnyway={onLogAnyway} onDismiss={onDismissFmRefusal} />
          {busy && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
        </>
      )}
      {tail.budgetHint && (
        <BudgetReplyActions
          replies={budget.replies}
          currency={budget.currency}
          now={Date.now()}
          busy={budget.busy}
          onOpenBudget={budget.onOpenBudget}
        />
      )}
    </View>
  );
}
