/**
 * The assistant's face. Renders the procedural Avatar today; this is the SINGLE
 * swap point for a future animated avatar (Lottie/Rive) — screens reference
 * <AssistantAvatar/> and never the avatar implementation directly.
 */
import React from 'react';
import { Avatar } from './Avatar';
import { defaultAvatar } from '../theme/assets';

export function AssistantAvatar({ size = 96 }: { size?: number }) {
  return <Avatar source={defaultAvatar} size={size} />;
}
