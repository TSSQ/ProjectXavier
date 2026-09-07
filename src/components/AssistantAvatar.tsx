/**
 * The assistant's face — the SINGLE swap point for the avatar implementation.
 * Reads the chosen avatar *kind* and *variant* from AvatarContext (loaded
 * once at the app root and updated instantly wherever Settings changes it —
 * see src/context/AvatarContext.tsx for why per-instance async reads used to
 * cause a colour blink on every tab change) and renders it through the
 * avatar registry. Screens pass a `state` for the expression. Adding a new
 * kind (Lottie/Rive, an illustrated character, AI art) means registering a
 * renderer — not touching this file or any screen.
 */
import { View } from 'react-native';
import { renderAvatar } from './avatars/registry';
import { AvatarState } from '../domain/avatar';
import { useAvatar } from '../context/AvatarContext';

export function AssistantAvatar({
  size = 96,
  state = 'idle',
}: {
  size?: number;
  state?: AvatarState;
}) {
  const { kind, look, loaded } = useAvatar();

  // Before the shared kind/look have loaded once, render a same-sized empty
  // placeholder rather than the default look: an avatar that pops in a beat
  // later already in its final colour reads far better than one that paints
  // the default and then flips — the same blink AvatarContext exists to
  // prevent. The placeholder keeps layout stable so nothing jumps once the
  // real avatar appears.
  if (!loaded) return <View style={{ width: size, height: size }} />;

  return renderAvatar(kind, { size, state, variantId: look.id });
}
