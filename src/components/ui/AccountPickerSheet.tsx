/**
 * AccountPickerSheet — a bottom-sheet list for picking an account.
 * Styled to match the standardized sheet design system: surface bg, border
 * token rows with inset hairline dividers, primary color for selection.
 */
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Account } from '../../domain/types';

export function AccountPickerSheet({
  visible,
  title,
  accounts,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  accounts: Account[];
  selectedId: string;
  onSelect: (account: Account) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/55 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface rounded-t-3xl pt-3 pb-8"
          style={{ maxHeight: '70%' }}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Grab handle */}
          <View className="w-9 h-1.5 rounded-full self-center mb-3" style={{ backgroundColor: '#3a414d' }} />

          {/* Header */}
          <View className="flex-row items-center justify-between px-4 mb-4">
            <Pressable
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
              accessibilityLabel="Close account picker"
            >
              <Feather name="x" size={16} color="#9AA4B2" />
            </Pressable>
            <Text className="text-text text-base font-extrabold">{title}</Text>
            <View className="w-8 h-8" />
          </View>

          {/* Account list */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 22 }}>
            <View className="bg-surface border border-border rounded-md overflow-hidden">
              {accounts.map((account, i) => {
                const selected = selectedId === account.id;
                return (
                  <View key={account.id}>
                    {i > 0 && (
                      <View
                        className="border-t border-border"
                        style={{ marginLeft: 16, marginRight: 16 }}
                      />
                    )}
                    <Pressable
                      onPress={() => {
                        onSelect(account);
                        onClose();
                      }}
                      className="flex-row items-center justify-between px-4 py-3.5"
                      style={{ gap: 12 }}
                      accessibilityLabel={account.name}
                    >
                      <Text
                        className={`text-base flex-1 ${selected ? 'text-primary font-semibold' : 'text-text'}`}
                        numberOfLines={1}
                      >
                        {account.name}
                      </Text>
                      {selected && (
                        <Feather name="check" size={16} color="#5B8DEF" />
                      )}
                    </Pressable>
                  </View>
                );
              })}
              {accounts.length === 0 && (
                <View className="px-4 py-4">
                  <Text className="text-muted text-center">No accounts available.</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
