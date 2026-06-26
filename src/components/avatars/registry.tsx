/**
 * Avatar renderer registry — maps an avatar `kind` to the component that draws
 * it. This is the component-layer counterpart to AVATAR_KINDS in
 * src/domain/avatar.ts (which holds the kinds as pure data).
 *
 * To add a new kind: build its renderer (must honour all five AvatarStates),
 * register it here, and flip `available: true` for that kind in AVATAR_KINDS.
 * AssistantAvatar resolves the renderer through here, so it stays the single
 * swap point and nothing else in the app needs to know which kind is active.
 */
import React from 'react';
import { View } from 'react-native';
import { XavierPet } from '../ui/XavierPet';
import { AvatarKind, AvatarState, lookById } from '../../domain/avatar';
import { colors } from '../../theme/tokens';

export interface AvatarRenderProps {
  size: number;
  state: AvatarState;
  /** The kind's selected variant id. For `blob` this is the colour look id;
   *  future kinds interpret it however they like. */
  variantId: string;
  /** Evolution stage (0-based). Drives a subtle treatment until per-stage art
   *  exists (ADR 0004). Optional; absent/0 renders the base avatar. */
  stage?: number;
}

export type AvatarRenderer = (props: AvatarRenderProps) => React.ReactElement;

/**
 * Wraps an avatar with a stage-based aura + micro-scale. Keeps the layout box
 * at `size` (aura is absolutely positioned, scale is a transform) so callers'
 * sizing is unaffected. A placeholder reward until real per-stage art lands.
 */
function StageWrap({
  size,
  stage = 0,
  children,
}: {
  size: number;
  stage?: number;
  children: React.ReactNode;
}): React.ReactElement {
  if (stage <= 0) return <>{children}</>;
  const lvl = Math.min(stage, EVOLUTION_VISUAL_CAP);
  const aura = size * 0.92;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: aura,
          height: aura,
          borderRadius: aura / 2,
          backgroundColor: colors.primary,
          opacity: 0.05 + lvl * 0.05,
        }}
      />
      <View style={{ transform: [{ scale: 1 + lvl * 0.015 }] }}>{children}</View>
    </View>
  );
}

/** Cap the visual intensity so high stages don't blow out the treatment. */
const EVOLUTION_VISUAL_CAP = 5;

/** kind id → renderer. Only kinds with an entry here are actually drawable;
 *  unknown kinds fall back to `blob` via renderAvatar(). */
const RENDERERS: Partial<Record<AvatarKind, AvatarRenderer>> = {
  blob: ({ size, state, variantId, stage }) => (
    <StageWrap size={size} stage={stage}>
      <XavierPet size={size} state={state} look={lookById(variantId)} />
    </StageWrap>
  ),
};

export function renderAvatar(
  kind: AvatarKind,
  props: AvatarRenderProps
): React.ReactElement {
  const renderer = RENDERERS[kind] ?? RENDERERS.blob!;
  return renderer(props);
}
