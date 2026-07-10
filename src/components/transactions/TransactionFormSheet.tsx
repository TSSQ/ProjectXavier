/**
 * TransactionFormSheet — shared form UI for add/edit/copy transactions.
 *
 * Owns: AmountExpr state, all picker-open booleans, form field state,
 * the pinned-keypad layout, and renders the BottomSheet shell.
 *
 * Does NOT own: save logic, diagnostics, recurring-series creation — those
 * stay in the screen's onSave callback. The component resolves amountMinor
 * from the expr and passes FormValues to onSave; the screen does everything
 * else with that data.
 *
 * Amount validation (null/≤0 resolution) is done here so the keypad can show
 * a focused error without ever calling onSave; the screen's own guard in
 * onSave still runs for account-missing / transfer-target checks.
 *
 * Layout (three-region sheet):
 *   Header (grab handle + ✕ / title / headerRight) — owned by BottomSheet
 *   Body (scrollable, flex:1):
 *     AmountDisplay (flex:1, absorbs slack, centered)
 *     SegmentedControl
 *     AssignmentCard
 *   Footer (pinned, flex:0) — passed to BottomSheet `footer` prop:
 *     AmountKeypad
 *     error text
 *     primary Button
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Pressable,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Account, Category, Payee, RecurrenceRule } from '../../domain/types';
import { useThemeColors } from '../../theme/useThemeColors';
import {
  AmountExpr,
  AmountKey,
  applyKey as applyAmountKey,
  emptyExpr,
  fromMinorUnits,
  isCalculation,
  pendingOperator,
  resolveMinorUnits,
} from '../../domain/amountExpression';
import { describeRuleShort } from '../../domain/recurrence';
import { formatDMY } from '../../domain/dates';
import { ComboItem } from '../ui/Combobox';
import { AmountDisplay } from '../ui/AmountDisplay';
import { AmountKeypad } from '../ui/AmountKeypad';
import { AssignmentRow, AssignmentCard } from '../ui/AssignmentRow';
import { AccountPickerSheet } from '../ui/AccountPickerSheet';
import { NoteSheet } from '../ui/NoteSheet';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Combobox } from '../ui/Combobox';
import { DateField } from '../ui/DateField';
import { RepeatSheet } from '../ui/RepeatSheet';

// ── Types ──────────────────────────────────────────────────────────────────

export type TxType = 'expense' | 'income' | 'transfer';

/**
 * The form values passed in via `initial` and passed back to `onSave`.
 * Amount is always in minor units (integer cents). Screens convert to/from
 * minor units at their boundary; the form never touches major-unit strings.
 */
export interface FormValues {
  accountId: string;
  transferAccountId: string;
  type: TxType;
  /** Amount as integer minor units (cents). 0 = empty/no amount yet. */
  amountMinor: number;
  date: number;
  categoryName: string;
  payeeName: string;
  note: string;
  repeatRule: RecurrenceRule | null;
  /** Screen-specific metadata carried through unchanged. */
  seriesId: string | null;
  occurrenceDate: number | null;
  /** Excluded from every money aggregation while true (see domain/types.ts
   *  isCounted). Defaults to false — not pending. */
  pending: boolean;
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface TransactionFormSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  mode: 'add' | 'edit' | 'copy';
  accounts: Account[];
  categories: Category[];
  payees: Payee[];
  currency: string;
  /** When provided, the Account row is disabled (read-only — locked to this account). */
  lockedAccountId?: string;
  /** When true, shows the Repeat row (transactions screen only). */
  showRepeat?: boolean;
  /** Banner text shown in copy mode. */
  copyLabel?: string;
  /** Seeds the form. The component re-seeds whenever this reference changes. */
  initial: FormValues;
  onSave: (values: FormValues) => Promise<void>;
  onDelete?: () => void;
  onScanReceipt?: () => void;
  busy: boolean;
  error: string | null;
}

const TX_TYPES: TxType[] = ['expense', 'income', 'transfer'];

// ── Component ──────────────────────────────────────────────────────────────

export function TransactionFormSheet({
  visible,
  onClose,
  title,
  mode,
  accounts,
  categories,
  payees,
  currency,
  lockedAccountId,
  showRepeat = false,
  copyLabel,
  initial,
  onSave,
  onDelete,
  onScanReceipt,
  busy,
  error: externalError,
}: TransactionFormSheetProps) {
  const c = useThemeColors();
  // ── Form state (seeded from `initial` each time it changes) ──────────────
  const [accountId, setAccountId] = useState(initial.accountId);
  const [transferAccountId, setTransferAccountId] = useState(initial.transferAccountId);
  const [type, setType] = useState<TxType>(initial.type);
  const [amountExpr, setAmountExpr] = useState<AmountExpr>(() =>
    initial.amountMinor > 0 ? fromMinorUnits(initial.amountMinor) : emptyExpr()
  );
  const [date, setDate] = useState(initial.date);
  const [categoryName, setCategoryName] = useState(initial.categoryName);
  const [payeeName, setPayeeName] = useState(initial.payeeName);
  const [note, setNote] = useState(initial.note);
  const [repeatRule, setRepeatRule] = useState<RecurrenceRule | null>(initial.repeatRule);
  const [pending, setPending] = useState(initial.pending ?? false);
  const [localError, setLocalError] = useState<string | null>(null);

  // ── Picker-open booleans ─────────────────────────────────────────────────
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [toAccountPickerOpen, setToAccountPickerOpen] = useState(false);
  const [payeeOpen, setPayeeOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [noteSheetOpen, setNoteSheetOpen] = useState(false);
  const [repeatSheetOpen, setRepeatSheetOpen] = useState(false);

  // Re-seed all state whenever `initial` changes (i.e., when openAdd/openEdit
  // builds a new initial object). Comparing by reference: the caller must pass
  // a new object each time it wants a reset (which openAdd/openEdit already do).
  useEffect(() => {
    setAccountId(initial.accountId);
    setTransferAccountId(initial.transferAccountId);
    setType(initial.type);
    setAmountExpr(initial.amountMinor > 0 ? fromMinorUnits(initial.amountMinor) : emptyExpr());
    setDate(initial.date);
    setCategoryName(initial.categoryName);
    setPayeeName(initial.payeeName);
    setNote(initial.note);
    setRepeatRule(initial.repeatRule);
    setPending(initial.pending ?? false);
    setLocalError(null);
  }, [initial]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const accountsById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );
  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );
  const payeesById = useMemo(
    () => new Map(payees.map((p) => [p.id, p])),
    [payees]
  );

  const activeAccounts = accounts.filter((a) => !a.archived);
  const transferChoices = activeAccounts.filter((a) => a.id !== accountId);

  const categoryItems: ComboItem[] = categories
    .filter((c) => c.kind === type)
    .map((c) => ({ id: c.id, name: c.name }));
  const payeeItems: ComboItem[] = payees.map((p) => ({
    id: p.id,
    name: p.name,
    hint: p.defaultCategoryId
      ? categoriesById.get(p.defaultCategoryId)?.name
      : undefined,
  }));

  // Effective account id: when locked, always use the locked id.
  const effectiveAccountId = lockedAccountId ?? accountId;
  const lockedAccount = lockedAccountId ? accountsById.get(lockedAccountId) : undefined;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const clearError = useCallback(() => setLocalError(null), []);

  const onAmountKey = useCallback((key: AmountKey) => {
    setAmountExpr((prev) => applyAmountKey(prev, key));
    clearError();
  }, [clearError]);

  const onSelectPayee = useCallback((item: ComboItem) => {
    const payee = payeesById.get(item.id);
    setPayeeName(item.name);
    // Side effect: auto-fill category from payee's default if category is empty.
    if (!categoryName.trim() && payee?.defaultCategoryId) {
      const cat = categoriesById.get(payee.defaultCategoryId);
      if (cat) setCategoryName(cat.name);
    }
    clearError();
  }, [payeesById, categoryName, categoriesById, clearError]);

  const handleSave = useCallback(async () => {
    if (busy) return;

    const minor = resolveMinorUnits(amountExpr);
    if (minor === null || minor <= 0) {
      setLocalError('Enter an amount greater than zero.');
      return;
    }

    const values: FormValues = {
      accountId: effectiveAccountId,
      transferAccountId,
      type,
      amountMinor: minor,
      date,
      categoryName,
      payeeName,
      note,
      repeatRule,
      seriesId: initial.seriesId,
      occurrenceDate: initial.occurrenceDate,
      pending,
    };

    await onSave(values);
  }, [
    busy, amountExpr, effectiveAccountId, transferAccountId, type,
    date, categoryName, payeeName, note, repeatRule, pending,
    initial.seriesId, initial.occurrenceDate, onSave,
  ]);

  // The error displayed to the user: local takes precedence, then external.
  const displayError = localError ?? externalError;

  // ── Derived button label ──────────────────────────────────────────────────
  const saveLabel =
    mode === 'edit'
      ? 'Update'
      : repeatRule && mode === 'add'
        ? 'Save & repeat'
        : mode === 'copy'
          ? 'Add copy'
          : 'Add';

  // ── headerRight: delete button ────────────────────────────────────────────
  const headerRight = onDelete ? (
    <Pressable
      onPress={onDelete}
      className="w-8 h-8 rounded-full bg-deleteChipBg items-center justify-center"
      accessibilityLabel="Delete transaction"
    >
      <Feather name="trash-2" size={15} color={c.deleteIcon} />
    </Pressable>
  ) : null;

  // ── Footer: keypad + error + save button ─────────────────────────────────
  const activeOp = pendingOperator(amountExpr);
  const calcMode = isCalculation(amountExpr);

  const footerContent = (
    <View>
      <AmountKeypad onKey={onAmountKey} activeOp={activeOp} />
      {displayError && (
        <Text className="text-negative text-xs px-1 pt-2">{displayError}</Text>
      )}
      <View style={{ paddingTop: 10 }}>
        <Button
          title={calcMode ? '=' : saveLabel}
          onPress={calcMode ? () => onAmountKey('equals') : handleSave}
          loading={calcMode ? false : busy}
        />
      </View>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        title={title}
        headerRight={headerRight}
        footer={footerContent}
        fillHeight
        avoidKeyboard={false}
      >
        {/* ① Amount display — flex:1, absorbs slack, vertically centered */}
        <AmountDisplay
          expr={amountExpr}
          currency={currency}
          onScanReceipt={onScanReceipt}
          type={type}
        />

        {/* ② Type selector */}
        <View style={{ paddingBottom: 12 }}>
          <SegmentedControl
            options={TX_TYPES}
            value={type}
            onChange={(t) => { setType(t); clearError(); }}
          />
        </View>

        {/* ③ Assignment card */}
        {/* Copy banner */}
        {mode === 'copy' && copyLabel && (
          <View className="flex-row items-center gap-2 bg-surfaceAlt border border-border rounded-md px-3 py-2 mb-3">
            <Feather name="copy" size={13} color={c.muted} />
            <Text className="text-muted text-xs">Copying · {copyLabel}</Text>
          </View>
        )}

        <AssignmentCard>
          {/* Account row — disabled when locked */}
          {lockedAccountId ? (
            <AssignmentRow
              icon="credit-card"
              label="Account"
              value={lockedAccount?.name ?? lockedAccountId}
              disabled
            />
          ) : (
            <AssignmentRow
              icon="credit-card"
              label="Account"
              value={accountsById.get(accountId)?.name}
              placeholder="Choose account"
              onPress={() => setAccountPickerOpen(true)}
            />
          )}

          {/* To account row — transfer only */}
          {type === 'transfer' && (
            <AssignmentRow
              icon="arrow-right-circle"
              label="To account"
              value={transferAccountId ? accountsById.get(transferAccountId)?.name : undefined}
              placeholder="Choose account"
              onPress={() => setToAccountPickerOpen(true)}
            />
          )}

          {/* Category — non-transfer only */}
          {type !== 'transfer' && (
            <AssignmentRow
              icon="tag"
              label="Category"
              value={categoryName || undefined}
              placeholder="Add category"
              onPress={() => { setCategoryOpen(true); clearError(); }}
            />
          )}

          {/* Payee — non-transfer only */}
          {type !== 'transfer' && (
            <AssignmentRow
              icon="user"
              label="Payee"
              value={payeeName || undefined}
              placeholder="Add payee"
              onPress={() => { setPayeeOpen(true); clearError(); }}
            />
          )}

          {/* Date */}
          <AssignmentRow
            icon="calendar"
            label="Date"
            value={formatDMY(date)}
            onPress={() => setDateOpen(true)}
          />

          {/* Note — icon updated to edit-2 per spec */}
          <AssignmentRow
            icon="edit-2"
            label="Note"
            value={note ? note.slice(0, 40) + (note.length > 40 ? '…' : '') : undefined}
            placeholder="Add note"
            onPress={() => setNoteSheetOpen(true)}
          />

          {/* Repeat — only when showRepeat is true and not in edit mode */}
          {showRepeat && mode !== 'edit' && (
            <AssignmentRow
              icon="repeat"
              label="Repeat"
              value={describeRuleShort(repeatRule)}
              onPress={() => setRepeatSheetOpen(true)}
            />
          )}
        </AssignmentCard>

        {/* Pending — excluded from every total/balance until toggled off.
            Same labelled-Switch pattern as the biometric toggle in settings.tsx. */}
        <View
          className="flex-row items-center gap-3 bg-surface border border-border rounded-md px-4 py-3.5 mt-3"
        >
          <Feather name="clock" size={18} color={c.muted} />
          <Text className="text-text text-base flex-1">Pending</Text>
          <Switch
            value={pending}
            onValueChange={setPending}
            thumbColor="#fff"
            trackColor={{ false: c.grabHandle, true: c.primary }}
            accessibilityLabel="Pending"
          />
        </View>

        {/* Hidden Combobox modals (controlled-open, no inline trigger) */}
        <Combobox
          placeholder="Payee"
          value={payeeName}
          items={payeeItems}
          onSelect={onSelectPayee}
          onCreate={(name) => { setPayeeName(name); clearError(); }}
          open={payeeOpen}
          onOpenChange={setPayeeOpen}
          hideTrigger
        />
        <Combobox
          placeholder="Category"
          value={categoryName}
          items={categoryItems}
          onSelect={(item) => { setCategoryName(item.name); clearError(); }}
          onCreate={(name) => { setCategoryName(name); clearError(); }}
          open={categoryOpen}
          onOpenChange={setCategoryOpen}
          hideTrigger
        />
        {/* Hidden DateField (controlled-open, no inline trigger) */}
        <DateField
          value={date}
          onChange={(ms) => { setDate(ms); clearError(); }}
          accessibilityLabel="Transaction date"
          open={dateOpen}
          onOpenChange={setDateOpen}
          hideTrigger
        />
      </BottomSheet>

      {/* Account pickers — rendered outside BottomSheet so they stack above it */}
      <AccountPickerSheet
        visible={accountPickerOpen}
        title="Account"
        accounts={activeAccounts}
        selectedId={accountId}
        onSelect={(account) => {
          setAccountId(account.id);
          // Reset transfer target if it was the same account.
          if (account.id === transferAccountId) setTransferAccountId('');
          clearError();
        }}
        onClose={() => setAccountPickerOpen(false)}
      />

      <AccountPickerSheet
        visible={toAccountPickerOpen}
        title="To account"
        accounts={transferChoices}
        selectedId={transferAccountId}
        onSelect={(account) => { setTransferAccountId(account.id); clearError(); }}
        onClose={() => setToAccountPickerOpen(false)}
      />

      <NoteSheet
        visible={noteSheetOpen}
        value={note}
        onChange={(t) => { setNote(t); clearError(); }}
        onClose={() => setNoteSheetOpen(false)}
      />

      <RepeatSheet
        visible={repeatSheetOpen}
        anchor={date}
        initialRule={repeatRule}
        onSelect={setRepeatRule}
        onClose={() => setRepeatSheetOpen(false)}
      />
    </>
  );
}

// Re-export ComboItem type for convenience.
export type { ComboItem };
