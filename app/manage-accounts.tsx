/**
 * Manage accounts — reached from Settings. Lists all accounts (no asset/
 * liability typing), with a "+" to add and a pencil to edit. Accounts carry an
 * optional cosmetic tag; currency is an app-level setting. Add/edit happens in
 * an inline form panel.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Account } from '../src/domain/types';
import { toMinorUnits, toMajorUnits } from '../src/domain/money';
import {
  listAccounts,
  createAccount,
  updateAccount,
} from '../src/features/accounts/repository';
import {
  getCurrency,
  DEFAULT_CURRENCY,
} from '../src/features/settings/repository';
import { accountIcon } from '../src/lib/accountIcon';
import { Card } from '../src/components/ui/Card';
import { Button } from '../src/components/ui/Button';
import { SectionLabel } from '../src/components/ui/SectionLabel';

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

  const refresh = useCallback(async () => {
    const [nextAccounts, nextCurrency] = await Promise.all([
      listAccounts(),
      getCurrency(),
    ]);
    setAccounts(nextAccounts);
    setCurrency(nextCurrency);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

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
    if (!name.trim()) {
      setError('Enter an account name.');
      return;
    }
    const major = parseFloat(opening);
    const base = {
      name: name.trim(),
      tag: tag.trim() || null,
      subtype: subtype.trim() || undefined,
      // Currency is an app-level setting, not a per-account choice.
      currency,
      openingBalance: toMinorUnits(Number.isFinite(major) ? major : 0),
    };
    setBusy(true);
    try {
      if (editor.mode === 'edit') {
        const existing = accounts.find((a) => a.id === editor.id);
        await updateAccount({
          id: editor.id,
          archived: existing?.archived ?? false,
          ...base,
        });
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

  const active = accounts.filter((a) => !a.archived);

  const renderRow = (a: Account) => {
    const { emoji, bg } = accountIcon(a);
    const meta = [a.subtype, a.tag].filter(Boolean).join(' · ') || 'Account';
    return (
      <View
        key={a.id}
        className="flex-row items-center gap-3 bg-surface border border-border rounded-md px-3.5 py-3 mb-2.5"
      >
        <View className={`w-10 h-10 rounded-xl items-center justify-center ${bg}`}>
          <Text className="text-lg">{emoji}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-text text-sm font-semibold">{a.name}</Text>
          <Text className="text-muted text-xs mt-0.5">{meta}</Text>
        </View>
        <Pressable
          onPress={() => openEdit(a)}
          className="w-9 h-9 rounded-sm bg-surfaceAlt items-center justify-center"
          accessibilityLabel={`Edit ${a.name}`}
        >
          <Feather name="edit-2" size={16} color="#F2F5F9" />
        </Pressable>
      </View>
    );
  };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 24, paddingTop: 56 }}>
      <View className="flex-row items-center justify-between mb-4">
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Feather name="chevron-left" size={24} color="#9AA4B2" />
        </Pressable>
        <Text className="text-text text-xl font-extrabold">Manage accounts</Text>
        <Pressable
          onPress={openAdd}
          className="w-9 h-9 rounded-pill bg-primary items-center justify-center"
          accessibilityLabel="Add account"
        >
          <Feather name="plus" size={20} color="#fff" />
        </Pressable>
      </View>

      {editor && (
        <Card style={{ gap: 12 }} className="mb-4">
          <Text className="text-text text-base font-semibold">
            {editor.mode === 'add' ? 'New account' : 'Edit account'}
          </Text>
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
            Tags are labels only — they don't affect net worth. All accounts use
            your app currency ({currency}), set in Settings.
          </Text>
          {error && <Text className="text-negative text-xs">{error}</Text>}
          <View className="flex-row" style={{ gap: 10 }}>
            <Button title="Cancel" variant="ghost" onPress={closeEditor} className="flex-1" />
            <Button
              title={editor.mode === 'add' ? 'Add' : 'Save'}
              onPress={onSave}
              loading={busy}
              className="flex-1"
            />
          </View>
        </Card>
      )}

      {active.length === 0 && !editor && (
        <Text className="text-muted">No accounts yet. Tap + to add one.</Text>
      )}

      {active.length > 0 && <SectionLabel>Accounts</SectionLabel>}
      {active.map(renderRow)}
    </ScrollView>
  );
}
