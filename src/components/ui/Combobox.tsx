import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { normalizeName } from '../../domain/payees';
import { colors } from '../../theme/tokens';

export interface ComboItem {
  id: string;
  name: string;
  /** Optional trailing hint shown on the right (e.g. a payee's category). */
  hint?: string;
}

/**
 * Searchable dropdown with inline "create". Type to filter the existing list;
 * if nothing matches the query you can create it on the spot. Selecting an
 * existing item calls `onSelect`; creating calls `onCreate` with the raw text.
 *
 * Controlled-open API (optional, back-compat):
 *   - `open` / `onOpenChange`: when provided the parent controls visibility.
 *   - `hideTrigger`: when true the inline Pressable trigger is not rendered,
 *     letting the parent (e.g. an AssignmentRow) own the visible trigger.
 * All three default to undefined / false so existing callers are unchanged.
 */
export function Combobox({
  placeholder,
  value,
  items,
  onSelect,
  onCreate,
  allowCreate = true,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  placeholder: string;
  value: string;
  items: ComboItem[];
  onSelect: (item: ComboItem) => void;
  onCreate: (name: string) => void;
  allowCreate?: boolean;
  /** Controlled open state. When provided, the parent drives visibility. */
  open?: boolean;
  /** Called when the modal wants to open or close itself. */
  onOpenChange?: (v: boolean) => void;
  /** When true, the inline trigger Pressable is not rendered. */
  hideTrigger?: boolean;
}) {
  const [openInternal, setOpenInternal] = useState(false);
  const [query, setQuery] = useState('');

  // Resolve controlled vs uncontrolled open state.
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = (v: boolean) => {
    if (openProp !== undefined) {
      onOpenChange?.(v);
    } else {
      setOpenInternal(v);
    }
  };

  // Clear stale query whenever the modal closes (including external/backdrop close).
  // This ensures the search field is blank the next time the modal opens.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const normalizedQuery = normalizeName(query);
  const filtered = useMemo(() => {
    if (!normalizedQuery) return items;
    return items.filter((i) => normalizeName(i.name).includes(normalizedQuery));
  }, [items, normalizedQuery]);

  const exactExists = items.some(
    (i) => normalizeName(i.name) === normalizedQuery
  );
  const showCreate = allowCreate && normalizedQuery.length > 0 && !exactExists;

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      {!hideTrigger && (
        <Pressable
          className="flex-row items-center bg-surfaceAlt rounded-sm px-3 py-2.5"
          onPress={() => setOpen(true)}
        >
          <Text className={value ? 'text-text text-base flex-1' : 'text-muted text-base flex-1'}>
            {value || placeholder}
          </Text>
          <Feather name="chevron-down" size={16} color={colors.textMuted} />
        </Pressable>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        {/* The autoFocus search box raises the keyboard immediately; without this
            the bottom-anchored sheet's option rows hide behind it. The keyboard-
            controller can't observe inside an RN <Modal> (separate native window),
            but RN's own KeyboardAvoidingView works here — and the dark sheet +
            backdrop mean no white-flash concern. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
        {/* No backdrop tint: the sheet stacks over the transaction form, which
            stays fully visible behind it. The transparent Pressable still
            catches outside taps to dismiss. */}
        <Pressable className="flex-1 justify-end" onPress={close}>
          <Pressable
            className="bg-bg rounded-t-2xl px-5 pt-4 pb-8"
            style={{ maxHeight: '75%' }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-text text-base font-bold">{placeholder}</Text>
              <Pressable onPress={close} accessibilityLabel="Close">
                <Feather name="x" size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            <View className="flex-row items-center bg-surface rounded-sm px-3 mb-3">
              <Feather name="search" size={16} color={colors.textMuted} />
              <TextInput
                className="flex-1 text-text px-2 py-2.5 text-base"
                placeholder="Search…"
                placeholderTextColor={colors.textMuted}
                value={query}
                onChangeText={setQuery}
                autoFocus
              />
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                showCreate ? (
                  <Pressable
                    className="flex-row items-center gap-2 py-3 px-2"
                    onPress={() => {
                      onCreate(query.trim());
                      close();
                    }}
                  >
                    <Feather name="plus" size={16} color={colors.primary} />
                    <Text className="text-primary text-base font-bold">
                      Create “{query.trim()}”
                    </Text>
                  </Pressable>
                ) : null
              }
              renderItem={({ item }) => (
                <Pressable
                  className="flex-row items-center py-3 px-2"
                  onPress={() => {
                    onSelect(item);
                    close();
                  }}
                >
                  <Text className="text-text text-base flex-1">{item.name}</Text>
                  {item.hint ? (
                    <Text className="text-muted text-xs">{item.hint}</Text>
                  ) : null}
                </Pressable>
              )}
              ListEmptyComponent={
                showCreate ? null : (
                  <Text className="text-muted text-center py-4">No matches.</Text>
                )
              }
            />
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
