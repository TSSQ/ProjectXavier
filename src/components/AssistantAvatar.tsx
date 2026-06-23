/**
 * The assistant's face — the SINGLE swap point for the avatar implementation.
 * Today it renders the animated XavierPet (SVG + Reanimated); screens reference
 * <AssistantAvatar/> and pass a `state` for the expression. Swapping to
 * Lottie/Rive later means changing only this file.
 */
import React from 'react';
import { XavierPet } from './ui/XavierPet';
import { AvatarState } from '../domain/avatar';

export function AssistantAvatar({
  size = 96,
  state = 'idle',
}: {
  size?: number;
  state?: AvatarState;
}) {
  return <XavierPet size={size} state={state} />;
}
