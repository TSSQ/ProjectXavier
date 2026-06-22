import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  FlatList,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { normalizeName } from '../../domain/payees';

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
 */
export function Combobox({
  placeholder,
  value,
  items,
  onSelect,
  onCreate,
  allowCreate = true,
}: {
  placeholder: string;
  value: string;
  items: ComboItem[];
  onSelect: (item: ComboItem) => void;
  onCreate: (name: string) => void;
  allowCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

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
      <Pressable
        className="flex-row items-center bg-surfaceAlt rounded-sm px-3 py-2.5"
        onPress={() => setOpen(true)}
      >
        <Text className={value ? 'text-text text-base flex-1' : 'text-muted text-base flex-1'}>
          {value || placeholder}
        </Text>
        <Feather name="chevron-down" size={16} color="#9AA4B2" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable className="flex-1 bg-black/60 justify-end" onPress={close}>
          <Pressable
            className="bg-bg rounded-t-2xl px-5 pt-4 pb-8"
            style={{ maxHeight: '75%' }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-text text-base font-bold">{placeholder}</Text>
              <Pressable onPress={close} accessibilityLabel="Close">
                <Feather name="x" size={20} color="#9AA4B2" />
              </Pressable>
            </View>

            <View className="flex-row items-center bg-surface rounded-sm px-3 mb-3">
              <Feather name="search" size={16} color="#9AA4B2" />
              <TextInput
                className="flex-1 text-text px-2 py-2.5 text-base"
                placeholder="Search…"
                placeholderTextColor="#9AA4B2"
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
                    <Feather name="plus" size={16} color="#5B8DEF" />
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
      </Modal>
    </>
  );
}
