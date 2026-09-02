import React from 'react';
import { AccessibilityActionEvent, GestureResponderEvent, View, Text, Pressable } from 'react-native';
import { Transaction, isUpcoming } from '../../domain/types';
import { formatMoney } from '../../domain/money';
import { SwipeAction, SwipeableRow } from './SwipeableRow';

const noop = () => {};

/**
 * Presentational ledger row. Used by the transactions screen and the
 * account-details screen; `app/period.tsx` uses it read-only. Pass
 * `signedAmount` to override the default sign (needed for transfers on a
 * per-account view); omit `accountName` to drop it from the meta line.
 *
 * `swipeActions` is opt-in (default: absent) — when omitted the row renders
 * exactly as before, so `app/period.tsx` (which never passes it) is
 * unaffected. When present, the row is wrapped in `SwipeableRow` and also
 * gains `accessibilityActions` mirroring the same actions, so VoiceOver users
 * (who can't swipe) reach Copy/Delete through the Actions rotor instead —
 * see docs/design/swipe-row-actions-spec.md §8.4.
 *
 * A future-dated (`occurredAt > now`), non-pending row gets an "Upcoming"
 * chip and the same dimmed amount `pending` already gets — the same
 * "recorded but not counted" treatment, just date-driven instead of manual
 * (docs/design/future-dated-transactions-spec.md §4.3). The two chips are
 * mutually exclusive: a pending row always shows "Pending", never both.
 *
 * `dateLabel` (docs/design/chat-transaction-delete-update-spec.md §5.4) is
 * additive and optional: the ledger groups rows by day under a section
 * header so it never passes this, but the chat transaction-op picker has no
 * such header and needs the date visible on the row itself.
 */
export function TransactionRow({
  tx,
  accountName,
  transferAccountName,
  categoryName,
  payeeName,
  dateLabel,
  signedAmount,
  onPress,
  onLongPress,
  swipeActions,
  swipeOpenKey,
  onSwipeOpen,
  onSwipeClose,
  onSwipeActive,
}: {
  tx: Transaction;
  accountName?: string;
  transferAccountName?: string;
  categoryName?: string;
  payeeName?: string;
  /** e.g. "Today" / "15-08-2026" — see the component header. Omitted by
   *  every existing caller, so their rendering is unchanged. */
  dateLabel?: string;
  signedAmount?: number;
  onPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  /** Copy/Delete revealed by swiping the row left. Omit to opt out entirely. */
  swipeActions?: SwipeAction[];
  /** The screen's single "which row is open" id — this row is open iff it
   *  equals `tx.id`. Single-open state is lifted to the screen, not kept
   *  here (spec §4.2). */
  swipeOpenKey?: string | null;
  onSwipeOpen?: (key: string) => void;
  onSwipeClose?: () => void;
  onSwipeActive?: (active: boolean) => void;
}) {
  const signed =
    signedAmount ?? (tx.type === 'income' ? tx.amount : -tx.amount);
  // Device clock, read here (not threaded as a prop) — this is a leaf UI
  // component, not a src/domain module, so this follows the same convention
  // src/components/ui/PeriodSheet.tsx already uses. Only decides whether to
  // show the "Upcoming" chip; never used for money math (that stays in
  // src/domain, with an injected clock).
  const now = Date.now();
  const upcoming = isUpcoming(tx, now);
  const dimmed = tx.pending || upcoming;
  const detail = [
    dateLabel,
    accountName,
    tx.type === 'transfer' && transferAccountName
      ? `to ${transferAccountName}`
      : null,
    categoryName,
  ].filter(Boolean);
  const icon = tx.type === 'income' ? '💰' : tx.type === 'transfer' ? '🔁' : '🧾';
  const iconBg =
    tx.type === 'income'
      ? 'bg-chipIncome'
      : tx.type === 'transfer'
        ? 'bg-chipTransfer'
        : 'bg-chipExpense';

  const body = (
    <>
      <View className={`w-10 h-10 rounded-md items-center justify-center ${iconBg}`}>
        <Text className="text-lg">{icon}</Text>
      </View>
      <View className="flex-1">
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Text className="text-text text-sm font-bold">
            {payeeName ?? sentenceCase(tx.type)}
          </Text>
          {tx.pending && (
            <View className="bg-badgeFlat border border-border rounded-pill px-1.5 py-0.5">
              <Text className="text-muted text-[9px] font-bold uppercase tracking-wide">
                Pending
              </Text>
            </View>
          )}
          {/* "Upcoming" is mutually exclusive with "Pending" (isUpcoming
              already excludes pending rows) — a row never shows both chips. */}
          {upcoming && (
            <View className="bg-badgeFlat border border-border rounded-pill px-1.5 py-0.5">
              <Text className="text-muted text-[9px] font-bold uppercase tracking-wide">
                Upcoming
              </Text>
            </View>
          )}
        </View>
        {detail.length > 0 ? (
          <Text className="text-muted text-xs mt-0.5">{detail.join(' · ')}</Text>
        ) : null}
        {tx.note ? <Text className="text-muted text-xs mt-0.5">{tx.note}</Text> : null}
      </View>
      <View className="items-end" style={{ gap: 8, opacity: dimmed ? 0.55 : 1 }}>
        <Text
          className={
            // Transfers move money between your own accounts, so they're
            // net-worth-neutral — shown in muted grey, not red/green.
            tx.type === 'transfer'
              ? 'text-muted text-[15px] font-bold'
              : signed >= 0
                ? 'text-positive text-[15px] font-bold'
                : 'text-negative text-[15px] font-bold'
          }
        >
          {formatMoney(signed, tx.currency)}
        </Text>
      </View>
    </>
  );

  const hasSwipe = !!swipeActions && swipeActions.length > 0;
  // `mb-2.5` (the gap between rows) must NOT be part of the card's own
  // height when swipe is enabled: SwipeableRow's action strip stretches to
  // match its content's rendered height (top/bottom: 0), so if the margin
  // were baked into that height the strip would bleed into the gap below
  // the card. Instead the margin moves to a plain wrapper around
  // SwipeableRow, and the card itself is unmargined. The non-swipe path is
  // untouched (identical className to before).
  const cardBase = 'flex-row items-center gap-3 bg-surface border border-border rounded-md p-3.5';
  const className = hasSwipe ? cardBase : `${cardBase} mb-2.5`;

  const rowAccessibility = hasSwipe
    ? {
        accessibilityLabel: rowAccessibilityLabel({ tx, payeeName, signed }),
        accessibilityActions: swipeActions!.map((a) => ({ name: a.key, label: a.label })),
        onAccessibilityAction: (event: AccessibilityActionEvent) => {
          swipeActions!.find((a) => a.key === event.nativeEvent.actionName)?.onPress();
        },
      }
    : {};

  const rowElement = (onPress || onLongPress) ? (
    <Pressable className={className} onPress={onPress} onLongPress={onLongPress} {...rowAccessibility}>
      {body}
    </Pressable>
  ) : (
    <View className={className} {...rowAccessibility}>{body}</View>
  );

  if (!hasSwipe) return rowElement;

  return (
    <View className="mb-2.5">
      <SwipeableRow
        rowKey={tx.id}
        actions={swipeActions!}
        openKey={swipeOpenKey ?? null}
        onOpen={onSwipeOpen ?? noop}
        onClose={onSwipeClose ?? noop}
        onSwipeActive={onSwipeActive}
      >
        {rowElement}
      </SwipeableRow>
    </View>
  );
}

/** "Payee, amount, date" — for VoiceOver users, who read the row's
 *  accessibilityLabel rather than seeing its section-header date. */
function rowAccessibilityLabel({
  tx,
  payeeName,
  signed,
}: {
  tx: Transaction;
  payeeName?: string;
  signed: number;
}): string {
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(tx.occurredAt)
  );
  return `${payeeName ?? sentenceCase(tx.type)}, ${formatMoney(signed, tx.currency)}, ${date}`;
}

function sentenceCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
