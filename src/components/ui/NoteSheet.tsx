/**
 * NoteSheet — a small BottomSheet with a single multiline note Input + Done.
 * The keyboard is fully isolated here: the amount keypad is not on screen,
 * so the system keyboard can appear without conflicting with any custom keypad.
 */
import React from 'react';
import { TextInput, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';

export function NoteSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: string;
  onChange: (text: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Note">
      <View style={{ gap: 12 }}>
        <TextInput
          className="bg-surfaceAlt text-text rounded-xl px-4 py-3 text-base"
          style={{ minHeight: 120, lineHeight: 22, textAlignVertical: 'top' }}
          placeholder="Add a note…"
          placeholderTextColor="#9AA4B2"
          value={value}
          onChangeText={onChange}
          multiline
          autoFocus
        />
        <Button title="Done" onPress={onClose} />
      </View>
    </BottomSheet>
  );
}
