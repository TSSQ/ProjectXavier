/**
 * AssistantExamplesSheet — "What can I ask?" bottom sheet listing grouped,
 * tappable example prompts (src/domain/assistantExamples.ts). Same sheet
 * design system as ModelPickerSheet: surface bg, inset hairline dividers
 * between rows, Feather icon accents. Reached from the assistant home
 * screen's "All commands" popover (app/(tabs)/index.tsx) — the ONE obvious
 * way in, not a second competing chip on the idle hero.
 *
 * Tapping an example PREFILLS the composer with its `text` and focuses it —
 * it never auto-sends; the caller (`onPickExample`) owns setting the draft
 * and re-focusing the field, mirroring how the slash-menu/quick-action chips
 * already hand text to the composer without submitting it.
 *
 * The footer is one honest sentence about BYOK (docs' non-negotiable copy
 * rules — never implies we receive user data, names it as the user's OWN
 * provider account) with a tap-through to Settings → Assistant → BYOK.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ASSISTANT_EXAMPLE_GROUPS } from '../../domain/assistantExamples';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';

export function AssistantExamplesSheet({
  visible,
  onPickExample,
  onOpenByok,
  onClose,
}: {
  visible: boolean;
  onPickExample: (text: string) => void;
  onOpenByok: () => void;
  onClose: () => void;
}) {
  const c = useThemeColors();
  const s = useScaledType();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/55 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface rounded-t-lg pt-3 pb-8"
          style={{ maxHeight: '80%' }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="w-9 h-1.5 rounded-pill self-center mb-3" style={{ backgroundColor: c.grabHandle }} />

          <View className="flex-row items-center justify-between px-4 mb-4">
            <Pressable
              hitSlop={6}
              onPress={onClose}
              className="w-8 h-8 rounded-pill bg-controlRaised items-center justify-center"
                  style={c.elevation.raised}
              accessibilityLabel="Close what can I ask"
            >
              <Feather name="x" size={16} color={c.muted} />
            </Pressable>
            <Text className="text-text font-extrabold" style={{ fontSize: s.role.control }}>
              What can I ask?
            </Text>
            <View className="w-8 h-8" />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 22 }}>
            {ASSISTANT_EXAMPLE_GROUPS.map((group) => (
              <View key={group.title} className="mb-5">
                <Text
                  className="text-muted font-bold uppercase mb-2"
                  style={{ fontSize: s.role.caption, letterSpacing: 0.5 }}
                >
                  {group.title}
                </Text>
                <View className="bg-surface border border-border rounded-md overflow-hidden">
                  {group.examples.map((example, i) => (
                    <View key={example.label}>
                      {i > 0 && (
                        <View className="border-t border-border" style={{ marginLeft: 16, marginRight: 16 }} />
                      )}
                      <Pressable
                        onPress={() => {
                          onPickExample(example.text);
                          onClose();
                        }}
                        className="flex-row items-center justify-between px-4 py-3.5"
                        style={{ gap: 12 }}
                        accessibilityLabel={`Try: ${example.label}`}
                      >
                        <Text
                          className="text-text flex-1"
                          style={{ fontSize: s.role.body }}
                          numberOfLines={2}
                        >
                          {example.label}
                        </Text>
                        <Feather name="arrow-up-right" size={15} color={c.muted} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            ))}

            <Pressable
              onPress={() => {
                onClose();
                onOpenByok();
              }}
              accessibilityLabel="Open bring your own key settings"
              className="mt-1 mb-2 px-1"
            >
              <Text className="text-muted text-center" style={{ fontSize: s.role.caption }}>
                Xavier runs on-device for free by default. Want sharper answers?
                Bring your own OpenAI or Anthropic key in Settings → Assistant.
              </Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
