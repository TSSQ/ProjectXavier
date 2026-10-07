import { useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Modal } from '../ui/Modal';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { TransactionRow } from '../ui/TransactionRow';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';
import { pickerSizeFor, SHEET_INLINE_PREVIEW_COUNT, TransactionCandidateFilter, DroppedConstraint } from '../../domain/transactionCandidates';
import { IconButton } from '../ui/IconButton';
import { Account, Category, Payee, Transaction } from '../../domain/types';
import { dateLabel } from './DraftCard';

/** Chat transaction delete/update picker state (docs/design/chat-
 *  transaction-delete-update-spec.md §5.4/§5.6) — one card at a time, same
 *  shape as pendingAccount/pendingAccountUpdate/deleteHandoff/queryAnswer.
 *  `op` is the ONE enum the model (or the deterministic floor) emitted; the
 *  model never sees or picks a row — only `candidates` + the user's tap do. */
export interface TxOpState {
  op: 'delete' | 'update';
  filter: TransactionCandidateFilter;
  /** The ledger snapshot loaded when this picker was built — reused by the
   *  §5.6 account-choice step so it doesn't need a second DB read. */
  transactions: Transaction[];
  candidates: Transaction[];
  droppedConstraints: DroppedConstraint[];
  /** getDataRevision() captured at build time — the picker is cleared if
   *  this no longer matches on focus (spec §9.5), so a user returning from
   *  the Transactions tab never taps a row that was changed/deleted there. */
  dataRevision: number;
}

/** "· 🔁" / "🔁 recurring" — the SAME treatment app/(tabs)/transactions.tsx's
 *  own renderItem uses for a posted recurring occurrence (spec §9.3: the
 *  picker row must show it's recurring). Kept as its own small helper here
 *  since that file's inline expression isn't exported. */
function txOpCategoryLabel(tx: Transaction, categoryName: string | undefined): string | undefined {
  if (categoryName) return tx.seriesId ? `${categoryName} · 🔁` : categoryName;
  return tx.seriesId ? '🔁 recurring' : undefined;
}

/** A ≥44pt tick box around a smaller visual box — same "big Pressable,
 *  small visual" shape as SwipeableRow's own action buttons
 *  (src/components/ui/SwipeableRow.tsx's SwipeActionButton), including its
 *  plain-object-`style` + local pressed-state convention (never
 *  function-form `style` — .eslintrc.js bans it, since NativeWind's
 *  cssInterop silently swallows it). Multi-select delete only (docs/design/
 *  chat-transaction-delete-update-spec.md §13 amendment) — never rendered
 *  for update. */
function TxOpCheckbox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  const c = useThemeColors();
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onToggle}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={checked ? 'Selected' : 'Not selected'}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: checked ? 0 : 2,
          borderColor: c.controlBorder,
          backgroundColor: checked ? c.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked && <Feather name="check" size={14} color="#fff" />}
      </View>
    </Pressable>
  );
}

/** One picker row — payee, amount, account AND date (spec §5.4: "every row
 *  shows payee, amount, date AND account" — the picker has no day-grouping
 *  header the way the ledger does, so `dateLabel` is required here, unlike
 *  every other TransactionRow caller). Recurring rows get the same "· 🔁"
 *  treatment as the ledger (spec §9.3); a transfer's row already names the
 *  counterparty via TransactionRow's own `transferAccountName` handling
 *  (spec §9.1/#14 — disclosed in both the row and the delete confirm).
 *
 *  `selectable` (spec §13 amendment, multi-select delete) renders a leading
 *  checkbox; the checkbox AND the row itself both call the SAME `onPress`
 *  (the caller passes a toggle, not an immediate pick, whenever
 *  `selectable` is true) so either gesture works and there is exactly one
 *  code path to reason about. */
function TxOpCandidateRow({
  tx,
  accountsById,
  categoriesById,
  payeesById,
  onPress,
  selectable = false,
  selected = false,
}: {
  tx: Transaction;
  accountsById: Map<string, Account>;
  categoriesById: Map<string, Category>;
  payeesById: Map<string, Payee>;
  /** Omitted on the confirm card, where the row is deliberately inert and the
   *  explicit Delete/Edit button is the only way to act. */
  onPress?: () => void;
  selectable?: boolean;
  selected?: boolean;
}) {
  const row = (
    <TransactionRow
      tx={tx}
      accountName={accountsById.get(tx.accountId)?.name ?? 'Unknown account'}
      transferAccountName={
        tx.transferAccountId ? accountsById.get(tx.transferAccountId)?.name : undefined
      }
      categoryName={txOpCategoryLabel(
        tx,
        tx.categoryId ? categoriesById.get(tx.categoryId)?.name : undefined
      )}
      payeeName={tx.payeeId ? payeesById.get(tx.payeeId)?.name : undefined}
      dateLabel={dateLabel(tx.occurredAt)}
      onPress={onPress}
    />
  );
  if (!selectable) return row;
  return (
    <View className="flex-row items-center" style={{ gap: 4 }}>
      <TxOpCheckbox checked={selected} onToggle={onPress ?? (() => {})} />
      <View style={{ flex: 1 }}>{row}</View>
    </View>
  );
}

/** The chat transaction delete/update picker card (docs/design/chat-
 *  transaction-delete-update-spec.md §5.4) — sized per `pickerSizeFor`:
 *  0 = a named-search "nothing found" state + "Open Transactions" (never a
 *  silent no-op, spec §9.4); 1 = a confirm card (still requires an explicit
 *  tap — never auto-executes, spec §7 acceptance #9); 2-5 = every candidate
 *  inline; >5 = the first 3 inline plus "Show all N" (rendered by
 *  TxOpShowAllSheet, a sibling of this card).
 *
 *  Multi-select delete (§13 amendment) — DELETE ONLY, never update — takes
 *  over rows once there is more than one candidate: a row tap toggles a
 *  checkbox instead of immediately picking, and a count-labelled destructive
 *  action appears once ≥1 is ticked. The 1-candidate confirm card stays a
 *  single row with the SAME `onPick` every size used before (Change 1 adds
 *  an explicit primary action there; it never becomes a checklist). */
export function TransactionOpPicker({
  txOp,
  accountsById,
  categoriesById,
  payeesById,
  busy,
  onPick,
  onDismiss,
  onShowAll,
  selectedIds,
  onToggleSelect,
  onDeleteSelected,
}: {
  txOp: TxOpState;
  accountsById: Map<string, Account>;
  categoriesById: Map<string, Category>;
  payeesById: Map<string, Payee>;
  busy: boolean;
  onPick: (tx: Transaction) => void;
  onDismiss: () => void;
  onShowAll: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDeleteSelected: () => void;
}) {
  const c = useThemeColors();
  const s = useScaledType();
  const router = useRouter();
  const size = pickerSizeFor(txOp.candidates.length);
  const verb = txOp.op === 'delete' ? 'Delete' : 'Update';
  // Delete-only, and only once there's more than one candidate — a single
  // candidate stays the Change-1 confirm card, never a 1-row checklist
  // (requirement #6 of the multi-select amendment).
  const multiSelect = txOp.op === 'delete' && size !== 'confirm';

  if (size === 'none') {
    return (
      <Card className="border-borderAccent self-stretch">
        <Text className="text-text font-bold mb-2.5" style={{ fontSize: s.role.prompt }}>
          Nothing to {verb.toLowerCase()}
        </Text>
        <Text className="text-muted text-[13px] mb-3">
          I couldn't find a matching transaction to {verb.toLowerCase()}.
        </Text>
        <View className="flex-row" style={{ gap: 10 }}>
          <Button title="Dismiss" variant="ghost" onPress={onDismiss} className="flex-1" />
          <Button
            title="Open Transactions"
            variant="primary"
            onPress={() => {
              onDismiss();
              router.push('/transactions');
            }}
            className="flex-1"
          />
        </View>
      </Card>
    );
  }

  const visibleCandidates =
    size === 'sheet' ? txOp.candidates.slice(0, SHEET_INLINE_PREVIEW_COUNT) : txOp.candidates;

  return (
    <Card className="border-borderAccent self-stretch">
      <Text className="text-text font-bold mb-2.5" style={{ fontSize: s.role.prompt }}>
        {size === 'confirm'
          ? `${verb} this transaction?`
          : multiSelect
            ? 'Select transactions to delete'
            : `${verb} which transaction?`}
      </Text>
      <View style={{ gap: 8 }}>
        {visibleCandidates.map((tx) => (
          <TxOpCandidateRow
            key={tx.id}
            tx={tx}
            accountsById={accountsById}
            categoriesById={categoriesById}
            payeesById={payeesById}
            // On the confirm (1-candidate) card the row is INERT: the explicit
            // Delete/Edit button below is the only way to act. Tapping the row
            // used to fire the same destructive path, which meant the card
            // asked "Delete this transaction?" and then tapping the thing it
            // was asking about answered "yes" — a second, invisible trigger for
            // an irreversible action. Multi-select rows still toggle.
            onPress={
              multiSelect ? () => onToggleSelect(tx.id) : size === 'confirm' ? undefined : () => onPick(tx)
            }
            selectable={multiSelect}
            selected={selectedIds.has(tx.id)}
          />
        ))}
      </View>
      {size === 'sheet' && (
        <Pressable
          onPress={onShowAll}
          className="mt-1 py-2 items-center"
          accessibilityLabel={`Show all ${txOp.candidates.length}`}
        >
          <Text className="text-primary font-bold" style={{ fontSize: s.role.control }}>
            Show all {txOp.candidates.length}
          </Text>
        </Pressable>
      )}
      {/* The same shape as the draft card's Discard · Edit · Save: equal-width
          pills on one row, the way out on the left and the committing action
          on the right. Previously this was a full-width coloured button with
          "Never mind" as a small text link underneath — a different visual
          language for the same kind of decision, and the destructive action
          got the most emphasis on the screen. */}
      <View className="flex-row mt-3" style={{ gap: 10 }}>
        <Button title="Never mind" variant="ghost" onPress={onDismiss} className="flex-1" />
        {size === 'confirm' && (
          <Button
            title={txOp.op === 'delete' ? 'Delete' : 'Edit'}
            variant={txOp.op === 'delete' ? 'destructive' : 'primary'}
            onPress={() => onPick(txOp.candidates[0]!)}
            className="flex-1"
          />
        )}
        {multiSelect && selectedIds.size > 0 && (
          <Button
            title={`Delete ${selectedIds.size}`}
            variant="destructive"
            onPress={onDeleteSelected}
            className="flex-1"
          />
        )}
      </View>
      {busy && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
    </Card>
  );
}

/** ">5" overflow sheet (spec §5.4) — a plain Modal, the SAME proven pattern
 *  AccountPickerSheet already uses, rather than the richer `BottomSheet`
 *  component: BottomSheet stacking a second sheet over this screen's own
 *  KeyboardAvoidingView is flagged as unverified (spec §12 open question 4),
 *  while Modal already renders above everything, including a sheet already
 *  on screen — the conservative, proven choice.
 *
 *  Multi-select delete (§13 amendment): this sheet only ever renders for the
 *  ">5" size, so for `op === 'delete'` every row here is always
 *  multi-select-eligible — same checkbox rows and count-labelled footer
 *  action as the inline card, so a selection made here (or in the inline
 *  top-3) survives switching between the two (selection state is lifted to
 *  the screen, not owned by either component). */
export function TxOpShowAllSheet({
  visible,
  txOp,
  accountsById,
  categoriesById,
  payeesById,
  onPick,
  onClose,
  selectedIds,
  onToggleSelect,
  onDeleteSelected,
}: {
  visible: boolean;
  txOp: TxOpState;
  accountsById: Map<string, Account>;
  categoriesById: Map<string, Category>;
  payeesById: Map<string, Payee>;
  onPick: (tx: Transaction) => void;
  onClose: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDeleteSelected: () => void;
}) {
  const c = useThemeColors();
  const multiSelect = txOp.op === 'delete';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/55 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface rounded-t-lg pt-3 pb-8"
          style={{ maxHeight: '80%' }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="w-9 h-1.5 rounded-pill self-center mb-3" style={{ backgroundColor: c.grabHandle }} />
          <View className="flex-row items-center justify-between px-4 mb-3">
            {/* This sheet is a raw Modal with animationType="slide" — there
                is no settle signal to gate on (the hazard ContextMenu.tsx's
                `point` mode avoids the same way), so the close button never
                mounts a real Glass here; QA round 1 caught this pattern
                already breaking BottomSheet's own close button. */}
            <IconButton size="md" tone="clear" icon="x" onPress={onClose} accessibilityLabel="Close" glass={false} />
            <Text className="text-text text-base font-extrabold">
              All matching transactions
            </Text>
            <View className="w-8 h-8" />
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
          >
            {txOp.candidates.map((tx) => (
              <TxOpCandidateRow
                key={tx.id}
                tx={tx}
                accountsById={accountsById}
                categoriesById={categoriesById}
                payeesById={payeesById}
                onPress={
                  multiSelect
                    ? () => onToggleSelect(tx.id)
                    : () => {
                        onClose();
                        onPick(tx);
                      }
                }
                selectable={multiSelect}
                selected={selectedIds.has(tx.id)}
              />
            ))}
          </ScrollView>
          {multiSelect && selectedIds.size > 0 && (
            <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
              {/* Full width here on purpose — this is a sheet footer, not the
                  confirmation card's action row. Same component and tone. */}
              <Button
                title={`Delete ${selectedIds.size} transaction${selectedIds.size === 1 ? '' : 's'}`}
                variant="destructive"
                onPress={() => {
                  onClose();
                  onDeleteSelected();
                }}
              />
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
