/**
 * Manage categories — reached from Settings. Searchable list filterable by
 * kind (All / Expense / Income / Transfer). Add/edit in a bottom sheet; delete
 * with a confirmation alert. Existing transactions keep their category_id —
 * deleting a category only removes it from the picker going forward.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Category, TransactionType } from '../src/domain/types';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../src/features/categories/repository';
import { Button } from '../src/components/ui/Button';
import { Input } from '../src/components/ui/Input';
import { BottomSheet } from '../src/components/ui/BottomSheet';
import { SegmentedControl } from '../src/components/ui/SegmentedControl';
import { IconPicker } from '../src/components/ui/IconPicker';
import { CATEGORY_ICONS } from '../src/domain/icons';
import { colors } from '../src/theme/tokens';

type KindFilter = 'all' | TransactionType;
const KIND_FILTERS: KindFilter[] = ['all', 'expense', 'income', 'transfer'];

const KIND_LABEL: Record<TransactionType, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
};
const KIND_COLOR: Record<TransactionType, string> = {
  expense: colors.negative,
  income: colors.positive,
  transfer: colors.textMuted,
};

type Editor = { mode: 'add' } | { mode: 'edit'; category: Category };

export default function ManageCategoriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Category[]>([]);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<TransactionType>('expense');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await listCategories());
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((c) => kindFilter === 'all' || c.kind === kindFilter)
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [items, kindFilter, query]);

  const openAdd = () => {
    setName('');
    setKind('expense');
    setIcon('');
    setError(null);
    setEditor({ mode: 'add' });
  };

  const openEdit = (c: Category) => {
    setName(c.name);
    setKind(c.kind);
    setIcon(c.icon ?? '');
    setError(null);
    setEditor({ mode: 'edit', category: c });
  };

  const closeEditor = () => { setEditor(null); setError(null); };

  const onSave = async () => {
    if (busy || !editor) return;
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a category name.');
    setBusy(true);
    try {
      const iconVal = icon.trim() || null;
      if (editor.mode === 'add') {
        await createCategory(trimmed, kind, iconVal);
      } else {
        await updateCategory(editor.category.id, { name: trimmed, kind, icon: iconVal });
      }
      await refresh();
      closeEditor();
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = () => {
    if (!editor || editor.mode !== 'edit') return;
    const { category } = editor;
    Alert.alert(
      'Delete category?',
      `"${category.name}" will be removed. Transactions that used it will keep their record but show no category.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteCategory(category.id);
            closeEditor();
            await refresh();
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* top bar */}
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Feather name="chevron-left" size={24} color={colors.textMuted} />
          </Pressable>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Pressable
              onPress={openAdd}
              className="w-9 h-9 rounded-full bg-primary items-center justify-center"
              accessibilityLabel="Add category"
            >
              <Feather name="plus" size={20} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => setSearchOpen((v) => !v)}
              className="w-9 h-9 rounded-full bg-surfaceAlt border border-border items-center justify-center"
              accessibilityLabel="Search categories"
            >
              <Feather name="search" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>

        <Text className="text-text text-xl font-extrabold mb-3">Categories</Text>

        {searchOpen && (
          <View className="flex-row items-center bg-surface border border-primary rounded-md px-3 mb-3">
            <Feather name="search" size={16} color={colors.textMuted} />
            <TextInput
              className="flex-1 text-text px-2 py-2.5 text-base"
              placeholder="Search categories…"
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
              autoFocus
            />
            <Pressable onPress={() => { setQuery(''); setSearchOpen(false); }} accessibilityLabel="Close search">
              <Feather name="x" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        )}

        {/* kind filter pills */}
        <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
          {KIND_FILTERS.map((f) => {
            const active = kindFilter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setKindFilter(f)}
                className={`rounded-pill px-3.5 py-1.5 ${active ? 'bg-primary' : 'bg-surfaceAlt border border-border'}`}
              >
                <Text className={`text-[12px] font-semibold ${active ? 'text-white' : 'text-muted'}`}>
                  {f === 'all' ? 'All' : KIND_LABEL[f]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filtered.length === 0 ? (
          <Text className="text-muted mt-2">
            {items.length === 0 ? 'Tap + to add your first category.' : 'No matching categories.'}
          </Text>
        ) : (
          filtered.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => openEdit(c)}
              className="flex-row items-center gap-3 bg-surface border border-border rounded-md px-3.5 py-3 mb-2.5"
            >
              <View className="w-10 h-10 rounded-xl bg-surfaceAlt items-center justify-center">
                <Text className="text-lg">{c.icon ?? '🏷️'}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-text text-sm font-semibold">{c.name}</Text>
                <Text style={{ color: KIND_COLOR[c.kind as TransactionType] ?? colors.textMuted }} className="text-xs mt-0.5">
                  {KIND_LABEL[c.kind as TransactionType] ?? c.kind}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </Pressable>
          ))
        )}
      </ScrollView>

      <BottomSheet
        visible={editor !== null}
        onClose={closeEditor}
        title={editor?.mode === 'edit' ? 'Edit category' : 'Add category'}
        headerRight={
          editor?.mode === 'edit' ? (
            <Pressable
              onPress={onDelete}
              className="w-8 h-8 rounded-full bg-deleteChipBg items-center justify-center"
              accessibilityLabel="Delete category"
            >
              <Feather name="trash-2" size={15} color={colors.deleteIcon} />
            </Pressable>
          ) : null
        }
        footer={
          <View>
            {error && <Text className="text-negative text-xs pb-2">{error}</Text>}
            <Button
              title={editor?.mode === 'edit' ? 'Save' : 'Add category'}
              onPress={onSave}
              loading={busy}
            />
          </View>
        }
      >
        {/* Body — scrollable form fields */}
        <View style={{ gap: 18 }}>
          <Input
            placeholder="Category name"
            value={name}
            onChangeText={setName}
          />
          <SegmentedControl
            options={['expense', 'income', 'transfer'] as TransactionType[]}
            value={kind}
            onChange={(k) => setKind(k as TransactionType)}
          />
          <View>
            <Text className="text-muted text-xs font-semibold mb-3">Icon</Text>
            <IconPicker
              icons={CATEGORY_ICONS}
              value={icon || null}
              onSelect={(picked) => setIcon((prev) => (prev === picked ? '' : picked))}
            />
          </View>
          <Text className="text-muted" style={{ fontSize: 13, lineHeight: 19 }}>
            Kind determines which transaction types this category appears in.
          </Text>
        </View>
      </BottomSheet>
    </View>
  );
}
