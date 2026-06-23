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
import { useFocusEffect, useRouter } from 'expo-router';
import { Account } from '../src/domain/types';
import { toMinorUnits, toMajorUnits } from '../src/domain/money';
import {
  listAccounts,
  createAccount,
  updateAccount,
} from '../src/features/accounts/repository';
import { getCurrency, DEFAULT_CURRENCY } from '../src/features/settings/repository';
import { accountIcon } from '../src/lib/accountIcon';
import { Button } from '../src/components/ui/Button';
import { BottomSheet } from '../src/components/ui/BottomSheet';

type Editor = { mode: 'add' } | { mode: 'edit'; id: string };

export default function ManageAccountsScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState('');
  const [opening, setOpening] = useState('');
  const [tag, setTag] = useState('');
  const [subtype, setSubtype] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

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
    setError(null);
    setEditor({ mode: 'add' });
  };

  const openEdit = (a: Account) => {
    setName(a.name);
    setOpening(toMajorUnits(a.openingBalance).toFixed(2));
    setTag(a.tag ?? '');
    setSubtype(a.subtype ?? '');
    setError(null);
    setEditor({ mode: 'edit', id: a.id });
  };

  const closeEditor = () => {
    setEditor(null);
    setError(null);
  };

  const onSave = async () => {
    if (busy || !editor) return;
    if (!name.trim()) return setError('Enter an account name.');
    const major = parseFloat(opening);
    const base = {
      name: name.trim(),
      tag: tag.trim() || null,
      subtype: subtype.trim() || undefined,
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
        <Feather name="chevron-right" size={18} color="#9AA4B2" />
      </Pressable>
    );
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 56 }}>
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Feather name="chevron-left" size={24} color="#9AA4B2" />
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
              <Feather name="search" size={16} color="#9AA4B2" />
            </Pressable>
          </View>
        </View>

        <Text className="text-text text-xl font-extrabold mb-3">Accounts</Text>

        {searchOpen && (
          <View className="flex-row items-center bg-surface border border-primary rounded-md px-3 mb-3">
            <Feather name="search" size={16} color="#9AA4B2" />
            <TextInput
              className="flex-1 text-text px-2 py-2.5 text-base"
              placeholder="Search name, tag, type…"
              placeholderTextColor="#9AA4B2"
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
              <Feather name="x" size={18} color="#9AA4B2" />
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
              className="w-8 h-8 rounded-full bg-[#3a1f27] items-center justify-center"
              accessibilityLabel="Archive account"
            >
              <Feather name="trash-2" size={15} color="#f08aa0" />
            </Pressable>
          ) : null
        }
      >
        <View style={{ gap: 10 }}>
          <TextInput
            className="bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
            placeholder="Account name"
            placeholderTextColor="#9AA4B2"
            value={name}
            onChangeText={setName}
          />
          <TextInput
            className="bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
            placeholder="Opening balance"
            placeholderTextColor="#9AA4B2"
            keyboardType="numbers-and-punctuation"
            value={opening}
            onChangeText={setOpening}
          />
          <TextInput
            className="bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
            placeholder="Subtype (bank, cash, credit_card…)"
            placeholderTextColor="#9AA4B2"
            autoCapitalize="none"
            value={subtype}
            onChangeText={setSubtype}
          />
          <TextInput
            className="bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"
            placeholder="Tag (optional, e.g. savings, card)"
            placeholderTextColor="#9AA4B2"
            autoCapitalize="none"
            value={tag}
            onChangeText={setTag}
          />
          <Text className="text-muted text-xs">
            Tags are labels only — they don't affect net worth. All accounts use your
            app currency ({currency}), set in Settings.
          </Text>
          {error && <Text className="text-negative text-xs">{error}</Text>}
          <Button
            title={editor?.mode === 'edit' ? 'Save' : 'Add'}
            onPress={onSave}
            loading={busy}
          />
        </View>
      </BottomSheet>
    </View>
  );
}
