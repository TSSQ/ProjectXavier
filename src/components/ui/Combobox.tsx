import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  FlatList,
  ScrollView,
  ScrollViewProps,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Modal } from './Modal';
import { Feather } from '@expo/vector-icons';
import { normalizeName } from '../../domain/payees';
import { groupByLetter, shouldShowRail, sortByName } from '../../domain/alphaIndex';
import { useThemeColors } from '../../theme/useThemeColors';
import { AlphaRail } from './AlphaRail';

/**
 * FlatList scrolls through a ref to its inner ScrollView, but NativeWind's
 * interop wrapper drops `ref` on RN 0.81's function-component ScrollView, so
 * scrollToIndex silently did nothing. Opting the inner ScrollView out of
 * interop (it takes no className) keeps the ref FlatList attaches via
 * cloneElement.
 */
const renderPlainScroll = (props: ScrollViewProps) => <ScrollView {...props} cssInterop={false} />;

type Row = { type: 'header'; key: string } | { type: 'item'; item: ComboItem };

/** Right padding so rows and hints clear the A-Z rail. */
const RAIL_GUTTER = 28;
const MAX_JUMP_RETRIES = 3;
/** Approximate height of one create/clear row in the list header. */
const HEADER_ROW_ESTIMATE = 46;

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
    const matches = normalizedQuery
      ? items.filter((i) => normalizeName(i.name).includes(normalizedQuery))
      : items;
    return sortByName(matches);
  }, [items, normalizedQuery]);

  // Long, un-searched lists get letter headers + a quick-scroll rail; short or
  // filtered lists render exactly as a plain list.
  const showRail = shouldShowRail(filtered.length, query);
  const { rows, headerIndex, populated } = useMemo(() => {
    if (!showRail) {
      return {
        rows: filtered.map((item): Row => ({ type: 'item', item })),
        headerIndex: new Map<string, number>(),
        populated: new Set<string>(),
      };
    }
    const out: Row[] = [];
    const index = new Map<string, number>();
    for (const group of groupByLetter(filtered)) {
      index.set(group.key, out.length);
      out.push({ type: 'header', key: group.key });
      for (const item of group.items) out.push({ type: 'item', item });
    }
    return { rows: out, headerIndex: index, populated: new Set(index.keys()) };
  }, [filtered, showRail]);

  const listRef = useRef<FlatList<Row>>(null);
  // A jump to a not-yet-measured row retries a few times; each new jump starts
  // fresh, and a pending retry never outlives the component.
  const retries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRetryTimer = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };
  useEffect(() => clearRetryTimer, []);
  const jumpTo = (key: string) => {
    const index = headerIndex.get(key);
    if (index === undefined) return;
    retries.current = 0;
    clearRetryTimer();
    listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
  };

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
          className="flex-row items-center bg-controlRaised rounded-sm px-3 py-2.5"
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
            className="bg-bg rounded-t-lg px-5 pt-4 pb-8"
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

            <View style={{ flexShrink: 1 }}>
              <FlatList
                ref={listRef}
                renderScrollComponent={renderPlainScroll}
                showsVerticalScrollIndicator={!showRail}
                data={rows}
                keyExtractor={(row) => (row.type === 'header' ? `header:${row.key}` : row.item.id)}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={showRail ? { paddingRight: RAIL_GUTTER } : undefined}
                onScrollToIndexFailed={(info) => {
                  // Target row not measured yet: jump near it, then retry a
                  // bounded number of times.
                  if (retries.current >= MAX_JUMP_RETRIES) return;
                  retries.current += 1;
                  const headerRows = (showClear ? 1 : 0) + (showCreate ? 1 : 0);
                  listRef.current?.scrollToOffset({
                    offset: headerRows * HEADER_ROW_ESTIMATE + info.averageItemLength * info.index,
                    animated: false,
                  });
                  clearRetryTimer();
                  retryTimer.current = setTimeout(() => {
                    retryTimer.current = null;
                    listRef.current?.scrollToIndex({
                      index: info.index,
                      animated: false,
                      viewPosition: 0,
                    });
                  }, 50);
                }}
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
                  ) : undefined
                }
                renderItem={({ item: row }) => {
                  if (row.type === 'header') {
                    return (
                      <Text className="text-muted text-xs font-bold tracking-widest pt-2 pb-1 px-2">
                        {row.key}
                      </Text>
                    );
                  }
                  const item = row.item;
                  return (
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
                  );
                }}
                ListEmptyComponent={
                  showCreate ? undefined : (
                    <Text className="text-muted text-center py-4">No matches.</Text>
                  )
                }
              />
              {showRail && (
                <View style={{ position: 'absolute', right: -16, top: 0, bottom: 0 }}>
                  <AlphaRail
                    populated={populated}
                    onSelect={jumpTo}
                    accessibilityLabel="Jump to letter"
                  />
                </View>
              )}
            </View>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
