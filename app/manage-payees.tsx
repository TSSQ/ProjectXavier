/**
 * Manage payees — reached from Settings. Searchable list; add/edit in a
 * bottom sheet. Each payee has a name and an optional default category (auto-
 * filled when the payee is selected in the transaction form). Deleting a payee
 * keeps existing transactions intact; they will simply show no payee name.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Category, Payee } from '../src/domain/types';
import {
  listPayees,
  updatePayee,
  deletePayee,
  findOrCreateByName as findOrCreatePayee,
} from '../src/features/payees/repository';
import { listCategories, findOrCreateByName as findOrCreateCategory } from '../src/features/categories/repository';
import { Button } from '../src/components/ui/Button';
import { Input } from '../src/components/ui/Input';
import { BottomSheet } from '../src/components/ui/BottomSheet';
import { Fab } from '../src/components/ui/Fab';
import { SIZE } from '../src/theme/tokens';
import { Combobox, ComboItem } from '../src/components/ui/Combobox';
import { AlphaRail } from '../src/components/ui/AlphaRail';
import { groupByLetter, shouldShowRail } from '../src/domain/alphaIndex';
import { accountColor } from '../src/lib/accountColor';
import { stringHash, initialOf } from '../src/lib/stringHash';
import { useThemeColors } from '../src/theme/useThemeColors';

/** Right margin on list rows/headers so they clear the A-Z rail: the rail is
 *  40pt wide at right: 4 (44pt) and the content already has 24pt padding, so
 *  20pt more keeps rows clear of it. */
const RAIL_GUTTER = 20;

type Editor = { mode: 'add' } | { mode: 'edit'; payee: Payee };

export default function ManagePayeesScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [payees, setPayeesState] = useState<Payee[]>([]);
  const [categories, setCategoriesState] = useState<Category[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);

  const [name, setName] = useState('');
  const [defaultCategoryId, setDefaultCategoryId] = useState<string | null>(null);
  const [defaultCategoryName, setDefaultCategoryName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [p, c] = await Promise.all([listPayees(), listCategories()]);
    setPayeesState(p);
    setCategoriesState(c);
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const categoryItems: ComboItem[] = useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon ?? undefined })),
    [categories]
  );

  const selectedCategoryIcon = defaultCategoryId
    ? categoriesById.get(defaultCategoryId)?.icon ?? undefined
    : undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return payees;
    return payees.filter((p) => p.name.toLowerCase().includes(q));
  }, [payees, query]);

  const groups = useMemo(() => groupByLetter(filtered), [filtered]);
  const populated = useMemo(() => new Set(groups.map((g) => g.key)), [groups]);
  const showRail = shouldShowRail(filtered.length, query);
  const railGutter = showRail ? RAIL_GUTTER : 0;

  // Section header y offsets (relative to the ScrollView content container,
  // which the headers are direct children of), recorded from onLayout events.
  const scrollRef = useRef<ScrollView>(null);
  const headerY = useRef(new Map<string, number>());
  // Drop offsets for letters that no longer have a header.
  useEffect(() => {
    for (const k of Array.from(headerY.current.keys())) {
      if (!populated.has(k)) headerY.current.delete(k);
    }
  }, [populated]);
  // Top of the list within the screen, from a marker's layout event, so the
  // rail starts where the list does however tall the title/search block is.
  const [listTop, setListTop] = useState(0);
  const jumpTo = (key: string) => {
    const y = headerY.current.get(key);
    if (y !== undefined) scrollRef.current?.scrollTo({
        // The ScrollView runs under the status bar; land the header just below it.
        y: Math.max(0, y - insets.top - 8),
        animated: false,
      });
  };

  const openAdd = () => {
    setName('');
    setDefaultCategoryId(null);
    setDefaultCategoryName('');
    setError(null);
    setEditor({ mode: 'add' });
  };

  const openEdit = (p: Payee) => {
    setName(p.name);
    setDefaultCategoryId(p.defaultCategoryId ?? null);
    setDefaultCategoryName(
      p.defaultCategoryId ? (categoriesById.get(p.defaultCategoryId)?.name ?? '') : ''
    );
    setError(null);
    setEditor({ mode: 'edit', payee: p });
  };

  const closeEditor = () => { setEditor(null); setError(null); };

  const onSave = async () => {
    if (busy || !editor) return;
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a payee name.');
    setBusy(true);
    try {
      // A typed-new category name (from the combobox's inline "Create…") sets
      // defaultCategoryName but leaves defaultCategoryId null — resolve it to
      // an id here rather than silently dropping it. Payee defaults feed the
      // expense flow (auto-filled when the payee is picked on an expense),
      // so new categories from this form are created as 'expense'. An empty
      // name still clears the default.
      const trimmedCategoryName = defaultCategoryName.trim();
      const categoryId =
        !defaultCategoryId && trimmedCategoryName
          ? await findOrCreateCategory(trimmedCategoryName, 'expense')
          : defaultCategoryId;

      if (editor.mode === 'add') {
        await findOrCreatePayee(trimmed, categoryId);
      } else {
        await updatePayee(editor.payee.id, {
          name: trimmed,
          defaultCategoryId: categoryId,
        });
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
    const { payee } = editor;
    Alert.alert(
      'Delete payee?',
      `"${payee.name}" will be removed. Existing transactions are kept but will show no payee.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deletePayee(payee.id);
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
        ref={scrollRef}
        contentContainerStyle={{
          padding: 24,
          paddingTop: insets.top + 12,
          paddingBottom: SIZE.fab + 20 + insets.bottom,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* top bar */}
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} accessibilityLabel="Back">
            <Feather name="chevron-left" size={24} color={c.muted} />
          </Pressable>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Pressable
              hitSlop={4}
              onPress={() => setSearchOpen((v) => !v)}
              className="w-9 h-9 rounded-pill bg-controlRaised border border-border items-center justify-center"
              style={c.elevation.raised}
              accessibilityLabel="Search payees"
            >
              <Feather name="search" size={16} color={c.muted} />
            </Pressable>
          </View>
        </View>

        <Text className="text-text text-xl font-extrabold mb-3">Payees</Text>

        {searchOpen && (
          <View className="flex-row items-center bg-surface border border-primary rounded-md px-3 mb-3">
            <Feather name="search" size={16} color={c.muted} />
            <TextInput
              className="flex-1 text-text px-2 py-2.5 text-base"
              placeholder="Search payees…"
              placeholderTextColor={c.muted}
              value={query}
              onChangeText={setQuery}
              autoFocus
            />
            <Pressable onPress={() => { setQuery(''); setSearchOpen(false); }} accessibilityLabel="Close search">
              <Feather name="x" size={18} color={c.muted} />
            </Pressable>
          </View>
        )}

        <View onLayout={(e) => setListTop(e.nativeEvent.layout.y)} />

        {filtered.length === 0 ? (
          <Text className="text-muted mt-2">
            {payees.length === 0
              ? 'No payees yet — they are created automatically when you add transactions, or tap + to add one now.'
              : 'No matching payees.'}
          </Text>
        ) : (
          groups.map((group) => (
            <React.Fragment key={group.key}>
              <Text
                className="text-muted text-xs font-bold tracking-widest mt-1 mb-1.5"
                style={{ marginRight: railGutter }}
                onLayout={(e) => {
                  headerY.current.set(group.key, e.nativeEvent.layout.y);
                }}
              >
                {group.key}
              </Text>
              {group.items.map((p) => {
                const defaultCat = p.defaultCategoryId
                  ? categoriesById.get(p.defaultCategoryId)
                  : null;
                return (
                  <Pressable
                    key={p.id}
                    style={{ marginRight: railGutter }}
                    onPress={() => openEdit(p)}
                    className="flex-row items-center gap-3 bg-surface border border-border rounded-md px-3.5 py-3 mb-2.5"
                  >
                    <PayeeAvatar name={p.name} categoryIcon={defaultCat?.icon} />
                    <View className="flex-1">
                      <Text className="text-text text-sm font-semibold">{p.name}</Text>
                      <Text className="text-muted text-xs mt-0.5">
                        {defaultCat ? `Default: ${defaultCat.name}` : 'No default category'}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={c.muted} />
                  </Pressable>
                );
              })}
            </React.Fragment>
          ))
        )}
      </ScrollView>

      {showRail && (
        <View
          style={{
            position: 'absolute',
            right: 4,
            top: listTop,
            bottom: SIZE.fab + 20 + insets.bottom,
          }}
        >
          <AlphaRail
            populated={populated}
            onSelect={jumpTo}
            accessibilityLabel="Jump to letter"
          />
        </View>
      )}

      {/* Add (glass-standard-adoption-spec.md S1) — Root-stack screen, so
          insets.bottom is the home indicator only; there is no tab bar here. */}
      <Fab onPress={openAdd} accessibilityLabel="Add payee" />

      <BottomSheet
        visible={editor !== null}
        onClose={closeEditor}
        title={editor?.mode === 'edit' ? 'Edit payee' : 'Add payee'}
        headerRight={
          editor?.mode === 'edit' ? (
            <Pressable
              hitSlop={6}
              onPress={onDelete}
              className="w-8 h-8 rounded-pill bg-deleteChipBg items-center justify-center"
              accessibilityLabel="Delete payee"
            >
              <Feather name="trash-2" size={15} color={c.deleteIcon} />
            </Pressable>
          ) : null
        }
        footer={
          <View>
            {error && <Text className="text-negative text-xs pb-2">{error}</Text>}
            <Button
              title={editor?.mode === 'edit' ? 'Save' : 'Add payee'}
              onPress={onSave}
              loading={busy}
            />
          </View>
        }
      >
        {/* Body — scrollable form fields */}
        <View style={{ gap: 18 }}>
          <View style={{ gap: 6 }}>
            <Text className="text-muted text-[10px] font-bold uppercase tracking-wide">
              Name
            </Text>
            <Input
              placeholder="Payee name"
              value={name}
              onChangeText={setName}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text className="text-muted text-[10px] font-bold uppercase tracking-wide">
              Default category
            </Text>
            <Combobox
              placeholder="Default category (optional)"
              value={defaultCategoryName}
              valueIcon={selectedCategoryIcon}
              items={categoryItems}
              onSelect={(item) => {
                setDefaultCategoryId(item.id);
                setDefaultCategoryName(item.name);
              }}
              onCreate={(n) => {
                setDefaultCategoryId(null);
                setDefaultCategoryName(n);
              }}
              clearLabel="No default category"
              onClear={() => {
                setDefaultCategoryId(null);
                setDefaultCategoryName('');
              }}
            />
          </View>
          <Text className="text-muted" style={{ fontSize: 13, lineHeight: 19 }}>
            The default category is auto-filled when you pick this payee in a transaction.
          </Text>
        </View>
      </BottomSheet>
    </View>
  );
}

/**
 * List-row avatar: the payee's default category emoji when set, else a
 * colored initial-letter circle (stable per payee name via a hash into the
 * shared account-color palette — no payee-level icon column, so the tile is
 * always derived, never stored).
 */
function PayeeAvatar({
  name,
  categoryIcon,
}: {
  name: string;
  categoryIcon?: string | null;
}) {
  if (categoryIcon) {
    return (
      <View className="w-10 h-10 rounded-md bg-badgeFlat items-center justify-center">
        <Text className="text-lg">{categoryIcon}</Text>
      </View>
    );
  }
  const bg = accountColor(stringHash(name), useThemeColors());
  return (
    <View
      className="w-10 h-10 rounded-md items-center justify-center"
      style={{ backgroundColor: bg }}
    >
      <Text className="text-white text-sm font-bold">{initialOf(name)}</Text>
    </View>
  );
}
