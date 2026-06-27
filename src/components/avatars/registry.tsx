/**
 * Avatar renderer registry — maps an avatar `kind` to the component that draws
 * it. This is the component-layer counterpart to AVATAR_KINDS in
 * src/domain/avatar.ts (which holds the kinds as pure data).
 *
 * To add a new kind: build its renderer (must honour all AvatarStates),
 * register it here, and flip `available: true` for that kind in AVATAR_KINDS.
 * AssistantAvatar resolves the renderer through here, so it stays the single
 * swap point and nothing else in the app needs to know which kind is active.
 */
import React from 'react';
import { XavierPet } from '../ui/XavierPet';
import { AvatarKind, AvatarState, lookById } from '../../domain/avatar';

export interface AvatarRenderProps {
  size: number;
  state: AvatarState;
  /** The kind's selected variant id. For `blob` this is the colour look id;
   *  future kinds interpret it however they like. */
  variantId: string;
}

export type AvatarRenderer = (props: AvatarRenderProps) => React.ReactElement;

/** kind id → renderer. Only kinds with an entry here are actually drawable;
 *  unknown kinds fall back to `blob` via renderAvatar(). */
const RENDERERS: Partial<Record<AvatarKind, AvatarRenderer>> = {
  blob: ({ size, state, variantId }) => (
    <XavierPet size={size} state={state} look={lookById(variantId)} />
  ),
};

export function renderAvatar(
  kind: AvatarKind,
  props: AvatarRenderProps
): React.ReactElement {
  const renderer = RENDERERS[kind] ?? RENDERERS.blob!;
  return renderer(props);
}
