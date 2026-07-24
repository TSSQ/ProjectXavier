/**
 * Manage accounts — reached from Settings. A clean, searchable list; add/edit
 * happens in a bottom-sheet dialog (no always-on inline form). The top bar has
 * a back chevron (left) and, on the right, "+" (add) then a search icon. Tap a
 * row to edit; archive from the sheet header. Accounts aren't typed
 * (asset/liability); an optional tag is cosmetic and currency is app-level.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Account } from '../src/domain/types';
import { toMinorUnits, toMajorUnits } from '../src/domain/money';
import { normalizeName } from '../src/domain/textMatch';
import {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccountCascade,
} from '../src/features/accounts/repository';
import { listTransactions } from '../src/features/transactions/repository';
import { listSeries } from '../src/features/recurring/repository';
import {
  computeAccountDeleteImpact,
  AccountDeleteImpact,
} from '../src/domain/accountDeleteImpact';
import { checkDeletePreflight } from '../src/domain/deletePreflight';
import { isAvailable as isICloudAvailable } from '../src/features/backup/icloud';
import { getCurrency, DEFAULT_CURRENCY } from '../src/features/settings/repository';
import { accountIcon } from '../src/lib/accountIcon';
import { Button } from '../src/components/ui/Button';
import { Input } from '../src/components/ui/Input';
import { AmountField } from '../src/components/ui/AmountField';
import { KeypadSheet } from '../src/components/ui/KeypadSheet';
import { BottomSheet } from '../src/components/ui/BottomSheet';
import { IconPicker } from '../src/components/ui/IconPicker';
import { ACCOUNT_ICONS } from '../src/domain/icons';
import { useThemeColors } from '../src/theme/useThemeColors';

type Editor = { mode: 'add' } | { mode: 'edit'; id: string };

/** The screen-only hard-delete confirm sheet's state — the ONLY place
 *  `deleteAccountCascade` (docs/design/account-chat-crud-spec.md §5.4/§5.5)
 *  is ever called from. `typedName` must match `account.name` (trimmed,
 *  case-insensitive) before "Delete permanently" enables — a tap alone is
 *  never enough for an irreversible cascade. */
interface DeleteConfirmState {
  account: Account;
  impact: AccountDeleteImpact;
  typedName: string;
  busy: boolean;
  error: string | null;
}

export default function ManageAccountsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  // Chat delete handoff deep link (docs/design/account-chat-crud-spec.md
  // §5.3) — "/manage-accounts?deleteAccountId=..." pre-selects the account by
  // opening its edit sheet, same as tapping the row; it does NOT auto-open
  // the destructive delete-confirm sheet below (the user still taps "Delete
  // permanently" and types the name themselves).
  const { deleteAccountId } = useLocalSearchParams<{ deleteAccountId?: string }>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState('');
  const [opening, setOpening] = useState('');
  const [tag, setTag] = useState('');
  const [subtype, setSubtype] = useState('');
  const [icon, setIcon] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  // The destructive "Delete permanently" sheet — separate from the ordinary
  // edit sheet (§5.5); `deleteAccountCascade` is the ONLY thing this state
  // ever leads to, and only after `typedName` matches.
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const deepLinkHandledRef = React.useRef(false);

  const refresh = useCallback(async () => {
    const [a, cur] = await Promise.all([listAccounts(), getCurrency()]);
    setAccounts(a);
    setCurrency(cur);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const active = accounts.filter((a) => !a.archived);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active;
    return active.filter((a) =>
      [a.name, a.tag ?? '', a.subtype ?? ''].some((s) =>
        s.toLowerCase().includes(q)
      )
    );
  }, [active, query]);

  const openAdd = () => {
    setName('');
    setOpening('');
    setTag('');
    setSubtype('');
    setIcon('');
    setError(null);
    setEditor({ mode: 'add' });
  };

  const openEdit = (a: Account) => {
    setName(a.name);
    setOpening(toMajorUnits(a.openingBalance).toFixed(2));
    setTag(a.tag ?? '');
    setSubtype(a.subtype ?? '');
    setIcon(a.icon ?? '');
    setError(null);
    setEditor({ mode: 'edit', id: a.id });
  };

  const closeEditor = () => {
    setEditor(null);
    setError(null);
  };

  // Pre-select the account named by the chat delete handoff's deep link,
  // once per navigation (guarded the same way app/(tabs)/index.tsx guards
  // its own widget deep links).
  useFocusEffect(
    useCallback(() => {
      if (deepLinkHandledRef.current || !deleteAccountId) return;
      const target = accounts.find((a) => a.id === deleteAccountId);
      if (!target) return;
      deepLinkHandledRef.current = true;
      openEdit(target);
    }, [deleteAccountId, accounts])
  );

  const onSave = async () => {
    if (busy || !editor) return;
    if (!name.trim()) return setError('Enter an account name.');
    const major = parseFloat(opening);
    const base = {
      name: name.trim(),
      tag: tag.trim() || null,
      subtype: subtype.trim() || undefined,
      icon: icon || null,
      currency, // app-level setting, not a per-account choice
      openingBalance: toMinorUnits(Number.isFinite(major) ? major : 0),
    };
    setBusy(true);
    try {
      if (editor.mode === 'edit') {
        const existing = accounts.find((a) => a.id === editor.id);
        await updateAccount({ id: editor.id, archived: existing?.archived ?? false, ...base });
      } else {
        await createAccount({ id: `acc_${Date.now()}`, ...base });
      }
      await refresh();
      closeEditor();
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onArchive = () => {
    if (!editor || editor.mode !== 'edit') return;
    const acc = accounts.find((a) => a.id === editor.id);
    if (!acc) return;
    Alert.alert('Archive account?', 'It will be hidden from your lists. Its transactions are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          await updateAccount({ ...acc, archived: true });
          closeEditor();
          await refresh();
        },
      },
    ]);
  };

  // "Delete permanently" — the ONLY entry point to `deleteAccountCascade`
  // (docs/design/account-chat-crud-spec.md §5.4/§5.5). Opens a SEPARATE sheet
  // (stacked over the edit sheet) showing the impact + a typed-name confirm.
  //
  // iCloud preflight (QA MAJOR follow-up): `deleteAccountCascade` itself
  // already refuses to delete without a completed forced backup (the real
  // safety net, unchanged) — but discovering that only after typing the
  // account's name is a dead end ("Could not delete. Please try again." can
  // never succeed if iCloud stays unavailable). Check UP FRONT instead and
  // give an actionable message, without even opening the destructive sheet.
  const openDeleteConfirm = async () => {
    if (!editor || editor.mode !== 'edit') return;
    const acc = accounts.find((a) => a.id === editor.id);
    if (!acc) return;

    const preflight = checkDeletePreflight(await isICloudAvailable());
    if (!preflight.allowed) {
      Alert.alert('Cannot delete right now', preflight.message ?? undefined);
      return;
    }

    const [txs, series] = await Promise.all([listTransactions(), listSeries()]);
    const impact = computeAccountDeleteImpact(acc.id, txs, series);
    setDeleteConfirm({ account: acc, impact, typedName: '', busy: false, error: null });
  };

  const closeDeleteConfirm = () => setDeleteConfirm(null);

  const onChangeDeleteTypedName = (typedName: string) =>
    setDeleteConfirm((prev) => (prev ? { ...prev, typedName, error: null } : prev));

  // `normalizeName` (trim + collapse internal whitespace + lowercase) — so
  // "DBS   Savings" or a trailing double-space typo still confirms, not just
  // an exact-whitespace match (QA MINOR follow-up).
  const deleteNameMatches = (state: DeleteConfirmState): boolean =>
    !!normalizeName(state.typedName) && normalizeName(state.typedName) === normalizeName(state.account.name);

  const onConfirmDeletePermanently = async () => {
    if (!deleteConfirm || deleteConfirm.busy || !deleteNameMatches(deleteConfirm)) return;
    setDeleteConfirm((prev) => (prev ? { ...prev, busy: true, error: null } : prev));
    try {
      await deleteAccountCascade(deleteConfirm.account.id);
      setDeleteConfirm(null);
      closeEditor();
      await refresh();
    } catch {
      // The pre-check above already caught the common case; a throw here
      // almost always means the forced pre-delete backup itself failed
      // (e.g. iCloud dropped between the check and this attempt) — no rows
      // were touched (deleteAccountCascade aborts before any destructive
      // statement runs), so this is always safe to retry once the real
      // cause is fixed.
      setDeleteConfirm((prev) =>
        prev
          ? {
              ...prev,
              busy: false,
              error: 'Could not delete — check your iCloud connection and try again.',
            }
          : prev
      );
    }
  };

  const renderRow = (a: Account) => {
    const { emoji, bg } = accountIcon(a);
    const meta = [a.subtype, a.tag].filter(Boolean).join(' · ') || 'Account';
    return (
      <Pressable
        key={a.id}
        onPress={() => openEdit(a)}
        className="flex-row items-center gap-3 bg-surface border border-border rounded-md px-3.5 py-3 mb-2.5"
      >
        <View className={`w-10 h-10 rounded-xl items-center justify-center ${bg}`}>
          <Text className="text-lg">{emoji}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-text text-sm font-semibold">{a.name}</Text>
          <Text className="text-muted text-xs mt-0.5">{meta}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={c.muted} />
      </Pressable>
    );
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 56 }}>
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Feather name="chevron-left" size={24} color={c.muted} />
          </Pressable>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Pressable
              onPress={openAdd}
              className="w-9 h-9 rounded-full bg-primary items-center justify-center"
              accessibilityLabel="Add account"
            >
              <Feather name="plus" size={20} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => setSearchOpen((v) => !v)}
              className="w-9 h-9 rounded-full bg-surfaceAlt border border-border items-center justify-center"
              accessibilityLabel="Search accounts"
            >
              <Feather name="search" size={16} color={c.muted} />
            </Pressable>
          </View>
        </View>

        <Text className="text-text text-xl font-extrabold mb-3">Accounts</Text>

        {searchOpen && (
          <View className="flex-row items-center bg-surface border border-primary rounded-md px-3 mb-3">
            <Feather name="search" size={16} color={c.muted} />
            <TextInput
              className="flex-1 text-text px-2 py-2.5 text-base"
              placeholder="Search name, tag, type…"
              placeholderTextColor={c.muted}
              value={query}
              onChangeText={setQuery}
              autoFocus
            />
            <Pressable
              onPress={() => {
                setQuery('');
                setSearchOpen(false);
              }}
              accessibilityLabel="Close search"
            >
              <Feather name="x" size={18} color={c.muted} />
            </Pressable>
          </View>
        )}

        {active.length === 0 ? (
          <Text className="text-muted">No accounts yet. Tap + to add one.</Text>
        ) : filtered.length === 0 ? (
          <Text className="text-muted">No matching accounts.</Text>
        ) : (
          filtered.map(renderRow)
        )}
      </ScrollView>

      <BottomSheet
        visible={editor !== null}
        onClose={closeEditor}
        title={editor?.mode === 'edit' ? 'Edit account' : 'Add account'}
        headerRight={
          editor?.mode === 'edit' ? (
            <Pressable
              onPress={onArchive}
              className="w-8 h-8 rounded-full bg-deleteChipBg items-center justify-center"
              accessibilityLabel="Archive account"
            >
              <Feather name="trash-2" size={15} color={c.deleteIcon} />
            </Pressable>
          ) : null
        }
        footer={
          <View>
            {error && <Text className="text-negative text-xs pb-2">{error}</Text>}
            {editor?.mode === 'edit' && (
              <Button
                title="View transactions"
                variant="ghost"
                onPress={() => {
                  if (!editor || editor.mode !== 'edit') return;
                  const accId = editor.id;
                  closeEditor();
                  // No period params → all-time view (not period-scoped).
                  router.push(`/account/${accId}`);
                }}
                className="mb-2"
              />
            )}
            <Button
              title={editor?.mode === 'edit' ? 'Save' : 'Add'}
              onPress={onSave}
              loading={busy}
            />
            {/* Destructive, distinct from Archive (the trash icon above) —
                the ONLY trigger for the hard-delete cascade (spec §5.5). */}
            {editor?.mode === 'edit' && (
              <Pressable
                onPress={openDeleteConfirm}
                accessibilityLabel="Delete account permanently"
                className="items-center justify-center mt-3"
              >
                <Text className="text-negative font-semibold" style={{ fontSize: 13 }}>
                  Delete permanently
                </Text>
              </Pressable>
            )}
          </View>
        }
      >
        {/* Body — scrollable form fields */}
        <View style={{ gap: 18 }}>
          <Input
            placeholder="Account name"
            value={name}
            onChangeText={setName}
          />
          <AmountField
            placeholder="Opening balance"
            valueMinor={opening === '' ? null : toMinorUnits(parseFloat(opening) || 0)}
            currency={currency}
            onPress={() => setKeypadOpen(true)}
          />
          <Input
            placeholder="Subtype (bank, cash, credit_card…)"
            autoCapitalize="none"
            value={subtype}
            onChangeText={setSubtype}
          />
          <Input
            placeholder="Tag (optional, e.g. savings, card)"
            autoCapitalize="none"
            value={tag}
            onChangeText={setTag}
          />
          <View>
            <Text className="text-muted text-xs font-semibold mb-3">Icon</Text>
            <IconPicker
              icons={ACCOUNT_ICONS}
              value={icon || null}
              onSelect={(picked) => setIcon((prev) => (prev === picked ? '' : picked))}
            />
          </View>
          <Text className="text-muted" style={{ fontSize: 13, lineHeight: 19 }}>
            Tags are labels only — they don&apos;t affect net worth. All accounts use your
            app currency ({currency}), set in Settings.
          </Text>
        </View>
      </BottomSheet>

      <KeypadSheet
        visible={keypadOpen}
        onClose={() => setKeypadOpen(false)}
        title="Opening balance"
        currency={currency}
        initialMinor={opening === '' ? 0 : toMinorUnits(parseFloat(opening) || 0)}
        onDone={(minor) => setOpening(toMajorUnits(minor).toFixed(2))}
      />

      {/* Destructive delete-confirm sheet (spec §5.5) — impact counts + a
          typed-name confirmation; "Delete permanently" stays disabled until
          `typedName` matches the account's real name. Stacked over the edit
          sheet (dimBackdrop=false so it stays visible behind). */}
      <BottomSheet
        visible={deleteConfirm !== null}
        onClose={closeDeleteConfirm}
        title="Delete permanently"
        dimBackdrop={false}
        footer={
          deleteConfirm ? (
            <View>
              {deleteConfirm.error && (
                <Text className="text-negative text-xs pb-2">{deleteConfirm.error}</Text>
              )}
              <Pressable
                onPress={onConfirmDeletePermanently}
                disabled={!deleteNameMatches(deleteConfirm) || deleteConfirm.busy}
                accessibilityLabel="Confirm delete permanently"
                className={`rounded-pill py-3 items-center justify-center ${
                  deleteNameMatches(deleteConfirm) ? 'bg-negative' : 'bg-surfaceAlt'
                }`}
              >
                <Text
                  className={`text-base font-bold ${
                    deleteNameMatches(deleteConfirm) ? 'text-white' : 'text-muted'
                  }`}
                >
                  {deleteConfirm.busy ? 'Deleting…' : 'Delete permanently'}
                </Text>
              </Pressable>
            </View>
          ) : null
        }
      >
        {deleteConfirm && (
          <View style={{ gap: 14 }}>
            <Text className="text-text" style={{ fontSize: 14, lineHeight: 20 }}>
              This permanently deletes{' '}
              <Text className="font-bold">{deleteConfirm.impact.transactionCount}</Text>{' '}
              transaction{deleteConfirm.impact.transactionCount === 1 ? '' : 's'}
              {deleteConfirm.impact.transferCount > 0 && (
                <>
                  , including <Text className="font-bold">{deleteConfirm.impact.transferCount}</Text>{' '}
                  transfer{deleteConfirm.impact.transferCount === 1 ? '' : 's'} with{' '}
                  {deleteConfirm.impact.counterpartyAccountIds
                    .map((id) => accounts.find((a) => a.id === id)?.name ?? 'another account')
                    .join(', ')}
                  , which changes {deleteConfirm.impact.counterpartyAccountIds.length === 1 ? 'its' : 'their'} balance
                </>
              )}
              {deleteConfirm.impact.recurringSeriesIds.length > 0 && (
                <>
                  {' '}and removes <Text className="font-bold">{deleteConfirm.impact.recurringSeriesIds.length}</Text>{' '}
                  recurring rule{deleteConfirm.impact.recurringSeriesIds.length === 1 ? '' : 's'} referencing it
                </>
              )}
              . Archive instead keeps everything.
            </Text>
            <Input
              placeholder={`Type "${deleteConfirm.account.name}" to confirm`}
              autoCapitalize="none"
              autoCorrect={false}
              value={deleteConfirm.typedName}
              onChangeText={onChangeDeleteTypedName}
            />
          </View>
        )}
      </BottomSheet>
    </View>
  );
}
