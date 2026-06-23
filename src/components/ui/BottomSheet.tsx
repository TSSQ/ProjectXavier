import React from 'react';
import { View, Text, Modal, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';

/**
 * Generic bottom-sheet dialog: a dimmed backdrop + a rounded sheet with a grab
 * handle and a header (✕ on the left, title centred, optional action on the
 * right). Body content scrolls. Used for add/edit forms so the underlying
 * screens stay clean lists.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  headerRight,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/55 justify-end" onPress={onClose}>
        <Pressable
          className="bg-[#23262C] rounded-t-2xl px-4 pt-3 pb-7"
          style={{ maxHeight: '88%' }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="w-9 h-1.5 rounded-full bg-[#4a4f57] self-center mb-3" />
          <View className="flex-row items-center justify-between mb-3">
            <Pressable
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-[#33373e] items-center justify-center"
              accessibilityLabel="Close"
            >
              <Feather name="x" size={16} color="#cfd6df" />
            </Pressable>
            <Text className="text-text text-base font-extrabold">{title}</Text>
            <View className="w-8 h-8 items-center justify-center">{headerRight}</View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
