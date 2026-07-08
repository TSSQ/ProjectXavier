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
import { useThemeColors } from '../../theme/useThemeColors';

export interface ComboItem {
  id: string;
  name: string;
  /** Optional trailing hint shown on the right (e.g. a payee's category). */
  hint?: string;
  /** Optional leading emoji rendered before the name (e.g. a category icon). */
  icon?: string;
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
  valueIcon,
  items,
  onSelect,
  onCreate,
  allowCreate = true,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
  clearLabel,
  onClear,
}: {
  placeholder: string;
  value: string;
  /** Optional leading emoji shown next to `value` in the collapsed trigger
   *  (e.g. the selected category's icon). Rendered as a sibling element, not
   *  concatenated into `value`, since the trigger text also doubles as the
   *  no-value placeholder. */
  valueIcon?: string;
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
  /** Label for the optional "clear selection" row (e.g. "No default
   *  category"). Only rendered when both this and `onClear` are supplied and
   *  there's a current non-empty `value` — otherwise there's nothing to
   *  clear. */
  clearLabel?: string;
  /** Called (instead of onSelect/onCreate) when the clear row is tapped. */
  onClear?: () => void;
}) {
  const c = useThemeColors();
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
  // Un-setting a selection is otherwise unreachable once a value is set — the
  // trigger only opens the picker, and the list only offers existing items or
  // "create new". Gated on a non-empty `value` (nothing to clear otherwise)
  // and on the caller opting in via both props, so callers that don't pass
  // them (e.g. TransactionFormSheet) see no change.
  const showClear = Boolean(clearLabel && onClear && value);

  // Only reserve a leading-icon gutter when this list actually uses icons —
  // existing callers that never pass `icon` keep pixel-identical rows. Within
  // an icon-enabled list, every row reserves the same width so items without
  // an icon still align with ones that have one.
  const hasIcons = items.some((i) => i.icon);

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
          {value && valueIcon ? (
            <Text className="text-base mr-1.5">{valueIcon}</Text>
          ) : null}
          <Text className={value ? 'text-text text-base flex-1' : 'text-muted text-base flex-1'}>
            {value || placeholder}
          </Text>
          <Feather name="chevron-down" size={16} color={c.muted} />
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
                <Feather name="x" size={20} color={c.muted} />
              </Pressable>
            </View>

            <View className="flex-row items-center bg-surface rounded-sm px-3 mb-3">
              <Feather name="search" size={16} color={c.muted} />
              <TextInput
                className="flex-1 text-text px-2 py-2.5 text-base"
                placeholder="Search…"
                placeholderTextColor={c.muted}
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
                showClear || showCreate ? (
                  <View>
                    {showClear && (
                      <Pressable
                        className="flex-row items-center gap-2 py-3 px-2"
                        onPress={() => {
                          onClear?.();
                          close();
                        }}
                        accessibilityLabel={clearLabel}
                      >
                        <Feather name="x-circle" size={16} color={c.muted} />
                        <Text className="text-muted text-base">{clearLabel}</Text>
                      </Pressable>
                    )}
                    {showCreate && (
                      <Pressable
                        className="flex-row items-center gap-2 py-3 px-2"
                        onPress={() => {
                          onCreate(query.trim());
                          close();
                        }}
                        accessibilityLabel={`Create ${query.trim()}`}
                      >
                        <Feather name="plus" size={16} color={c.primary} />
                        <Text className="text-primary text-base font-bold">
                          Create “{query.trim()}”
                        </Text>
                      </Pressable>
                    )}
                  </View>
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
                  {hasIcons ? (
                    <Text className="text-base mr-2" style={{ width: 22 }}>
                      {item.icon ?? ''}
                    </Text>
                  ) : null}
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
