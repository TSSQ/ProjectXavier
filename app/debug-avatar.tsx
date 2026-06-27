/**
 * Avatar evolution preview (test builds only).
 *
 * A dev harness for stepping the avatar through every stage and state so real
 * per-stage art can be eyeballed and transitions verified. Local component state
 * only — never reads or writes real progression settings. Reached from a hidden
 * Settings → Developer row that only appears when METRICS_ENABLED.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssistantAvatar } from '../src/components/AssistantAvatar';
import { renderAvatar } from '../src/components/avatars/registry';
import { AvatarState } from '../src/domain/avatar';
import { EVOLUTION_STAGES } from '../src/domain/evolution';

const ALL_STATES: AvatarState[] = ['idle', 'listening', 'thinking', 'happy', 'confused', 'angry'];

export default function DebugAvatarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState(0);
  const [state, setState] = useState<AvatarState>('idle');

  const maxStage = EVOLUTION_STAGES.length - 1;

  const onEvolve = () => setStage((s) => (s >= maxStage ? 0 : s + 1));
  const onReset = () => setStage(0);

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
          Dev harness · local state only · does not affect real progression.
        </Text>

        {/* Large avatar (main display) */}
        <View className="items-center mb-6">
          <AssistantAvatar size={172} state={state} stage={stage} />
          <Text className="text-text text-[15px] font-bold mt-4">
            Stage {stage} · {EVOLUTION_STAGES[stage]?.label ?? ''}
          </Text>
          <Text className="text-muted text-[13px] mt-1">State: {state}</Text>
        </View>

        {/* Stage controls */}
        <Text className="text-muted text-[10px] font-bold uppercase tracking-wide mb-2">
          Stage
        </Text>
        <View className="flex-row mb-6" style={{ gap: 10 }}>
          <Pressable
            onPress={onEvolve}
            className="flex-1 bg-primary rounded-md items-center justify-center py-3"
            accessibilityLabel="Evolve to next stage"
          >
            <Text className="text-white text-[13px] font-bold">Evolve →</Text>
          </Pressable>
          <Pressable
            onPress={onReset}
            className="flex-1 bg-surfaceAlt border border-border rounded-md items-center justify-center py-3"
            accessibilityLabel="Reset to stage 0"
          >
            <Text className="text-text text-[13px] font-bold">Reset</Text>
          </Pressable>
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

        {/* Consistency strip — all stages at once */}
        <Text className="text-muted text-[10px] font-bold uppercase tracking-wide mb-3">
          All stages (consistency strip)
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 12 }}>
          {EVOLUTION_STAGES.map((ev) => (
            <View key={ev.stage} className="items-center">
              {renderAvatar('blob', {
                size: 52,
                state,
                variantId: 'xavier',
                stage: ev.stage,
              })}
              <Text className="text-muted text-[10px] mt-1">
                {ev.stage} · {ev.label}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
