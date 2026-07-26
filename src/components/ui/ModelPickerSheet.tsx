/**
 * ModelPickerSheet — bottom-sheet list for picking a BYOK model
 * (docs/design/byok-model-picker-spec.md). Same sheet design system as
 * AccountPickerSheet: surface bg, inset hairline dividers, primary color for
 * the current selection. Always ends with a trailing "Custom…" row so the
 * user can fall back to typing an arbitrary model id.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ModelChoice } from '../../domain/byokModels';
import { useThemeColors } from '../../theme/useThemeColors';

export function ModelPickerSheet({
  visible,
  title,
  models,
  selectedId,
  onSelectModel,
  onSelectCustom,
  onClose,
}: {
  visible: boolean;
  title: string;
  models: ModelChoice[];
  selectedId: string;
  onSelectModel: (model: ModelChoice) => void;
  onSelectCustom: () => void;
  onClose: () => void;
}) {
  const c = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/55 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface rounded-t-3xl pt-3 pb-8"
          style={{ maxHeight: '70%' }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="w-9 h-1.5 rounded-full self-center mb-3" style={{ backgroundColor: c.grabHandle }} />

          <View className="flex-row items-center justify-between px-4 mb-4">
            <Pressable
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
              accessibilityLabel="Close model picker"
            >
              <Feather name="x" size={16} color={c.muted} />
            </Pressable>
            <Text className="text-text text-base font-extrabold">{title}</Text>
            <View className="w-8 h-8" />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 22 }}>
            <View className="bg-surface border border-border rounded-md overflow-hidden">
              {models.map((choice, i) => {
                const selected = selectedId === choice.id;
                return (
                  <View key={choice.id}>
                    {i > 0 && (
                      <View className="border-t border-border" style={{ marginLeft: 16, marginRight: 16 }} />
                    )}
                    <Pressable
                      onPress={() => {
                        onSelectModel(choice);
                        onClose();
                      }}
                      className="flex-row items-center justify-between px-4 py-3.5"
                      style={{ gap: 12 }}
                      accessibilityLabel={choice.label}
                    >
                      <Text
                        className={`text-base flex-1 ${selected ? 'text-primary font-semibold' : 'text-text'}`}
                        numberOfLines={1}
                      >
                        {choice.label}
                      </Text>
                      {selected && <Feather name="check" size={16} color={c.primary} />}
                    </Pressable>
                  </View>
                );
              })}
              <View>
                {models.length > 0 && (
                  <View className="border-t border-border" style={{ marginLeft: 16, marginRight: 16 }} />
                )}
                <Pressable
                  onPress={() => {
                    onSelectCustom();
                    onClose();
                  }}
                  className="flex-row items-center justify-between px-4 py-3.5"
                  style={{ gap: 12 }}
                  accessibilityLabel="Custom model id"
                >
                  <Text className="text-base flex-1 text-text">Custom…</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
