/**
 * AccountPickerSheet — a bottom-sheet list for picking an account.
 * Modeled after RepeatSheet's list presentation style.
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
          className="bg-[#23262C] rounded-t-2xl px-4 pt-3 pb-8"
          style={{ maxHeight: '70%' }}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Grab handle */}
          <View className="w-9 h-1.5 rounded-full bg-[#4a4f57] self-center mb-3" />

          {/* Header */}
          <View className="flex-row items-center justify-between mb-4">
            <Pressable
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-[#33373e] items-center justify-center"
              accessibilityLabel="Close account picker"
            >
              <Feather name="x" size={16} color="#cfd6df" />
            </Pressable>
            <Text className="text-text text-base font-extrabold">{title}</Text>
            <View className="w-8 h-8" />
          </View>

          {/* Account list */}
          <ScrollView showsVerticalScrollIndicator={false}>
            <View className="bg-white/5 rounded-2xl px-1">
              {accounts.map((account, i) => (
                <Pressable
                  key={account.id}
                  onPress={() => {
                    onSelect(account);
                    onClose();
                  }}
                  className={`flex-row items-center justify-between px-3 py-3.5 ${
                    i < accounts.length - 1 ? 'border-b border-white/5' : ''
                  }`}
                  accessibilityLabel={account.name}
                >
                  <Text
                    className={`text-[15px] ${
                      selectedId === account.id
                        ? 'text-[#5fd497] font-semibold'
                        : 'text-text'
                    }`}
                  >
                    {account.name}
                  </Text>
                  {selectedId === account.id && (
                    <Feather name="check" size={16} color="#5fd497" />
                  )}
                </Pressable>
              ))}
              {accounts.length === 0 && (
                <View className="px-3 py-4">
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
