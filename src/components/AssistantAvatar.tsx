/**
 * The assistant's face — the SINGLE swap point for the avatar implementation.
 * Renders the animated XavierPet (SVG + Reanimated) using the look chosen in
 * Settings (re-read on focus so changes apply immediately). Screens pass a
 * `state` for the expression. Swapping to Lottie/Rive later means changing only
 * this file.
 */
import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { XavierPet } from './ui/XavierPet';
import { AvatarState, AvatarLook, lookById, DEFAULT_AVATAR_LOOK } from '../domain/avatar';
import { getAvatarLook } from '../features/settings/repository';

export function AssistantAvatar({
  size = 96,
  state = 'idle',
}: {
  size?: number;
  state?: AvatarState;
}) {
  const [look, setLook] = useState<AvatarLook>(lookById(DEFAULT_AVATAR_LOOK));

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getAvatarLook().then((id) => {
        if (active) setLook(lookById(id));
      });
      return () => {
        active = false;
      };
    }, [])
  );

  return <XavierPet size={size} state={state} look={look} />;
}
