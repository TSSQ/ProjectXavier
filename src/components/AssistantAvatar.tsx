/**
 * The assistant's face — the SINGLE swap point for the avatar implementation.
 * Reads the chosen avatar *kind* and *variant* from Settings (re-read on focus
 * so changes apply immediately) and renders it through the avatar registry.
 * Screens pass a `state` for the expression. Adding a new kind (Lottie/Rive,
 * an illustrated character, AI art) means registering a renderer — not touching
 * this file or any screen.
 */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { renderAvatar } from './avatars/registry';
import {
  AvatarState,
  AvatarKind,
  kindById,
  lookById,
  DEFAULT_AVATAR_KIND,
  DEFAULT_AVATAR_LOOK,
} from '../domain/avatar';
import { getAvatarKind, getAvatarLook } from '../features/settings/repository';

export function AssistantAvatar({
  size = 96,
  state = 'idle',
  stage = 0,
}: {
  size?: number;
  state?: AvatarState;
  /** Evolution stage (0-based); drives the avatar's stage treatment. */
  stage?: number;
}) {
  const [kind, setKind] = useState<AvatarKind>(DEFAULT_AVATAR_KIND);
  const [variantId, setVariantId] = useState<string>(DEFAULT_AVATAR_LOOK);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([getAvatarKind(), getAvatarLook()]).then(([k, look]) => {
        if (!active) return;
        setKind(kindById(k).id);
        setVariantId(lookById(look).id);
      });
      return () => {
        active = false;
      };
    }, [])
  );

  return renderAvatar(kind, { size, state, variantId, stage });
}
