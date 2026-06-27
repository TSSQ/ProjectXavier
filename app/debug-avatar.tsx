/**
 * Avatar state preview (test builds only).
 *
 * A dev harness for stepping the avatar through every state so moods can be
 * eyeballed. Local component state only — never reads or writes real settings.
 * Reached from a hidden Settings → Developer row that only appears when
 * METRICS_ENABLED.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssistantAvatar } from '../src/components/AssistantAvatar';
import { AvatarState } from '../src/domain/avatar';

const ALL_STATES: AvatarState[] = ['idle', 'listening', 'thinking', 'happy', 'confused', 'angry'];

export default function DebugAvatarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<AvatarState>('idle');

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: 40 }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <Pressable
            onPress={() => router.back()}
            accessibilityLabel="Back"
            className="flex-row items-center"
          >
            <Feather name="chevron-left" size={24} color="#9AA4B2" />
            <Text className="text-muted text-base ml-1">Back</Text>
          </Pressable>
        </View>

        <Text className="text-text text-[24px] font-extrabold mb-1">Avatar preview</Text>
        <Text className="text-muted text-xs mb-6">
          Avatar state preview · local state only
        </Text>

        {/* Large avatar (main display) */}
        <View className="items-center mb-6">
          <AssistantAvatar size={172} state={state} />
          <Text className="text-muted text-[13px] mt-4">State: {state}</Text>
        </View>

        {/* State selector */}
        <Text className="text-muted text-[10px] font-bold uppercase tracking-wide mb-2">
          State
        </Text>
        <View className="flex-row flex-wrap mb-6" style={{ gap: 8 }}>
          {ALL_STATES.map((s) => {
            const active = s === state;
            return (
              <Pressable
                key={s}
                onPress={() => setState(s)}
                className={`rounded-pill px-4 py-2 ${active ? 'bg-primary' : 'bg-surfaceAlt border border-border'}`}
                accessibilityLabel={`Set state ${s}`}
              >
                <Text
                  className={
                    active ? 'text-white text-[13px] font-semibold' : 'text-muted text-[13px]'
                  }
                >
                  {s}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
