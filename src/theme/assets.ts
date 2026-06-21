/**
 * Asset indirection layer.
 *
 * Everything visual is referenced through this module so we can start with
 * free/procedural assets (DiceBear avatars, Lucide icons) and later swap in
 * custom AI-generated art — by changing only this file — once an
 * image-generation MCP/pipeline is connected. App code never hard-codes an
 * asset path.
 */

export type AvatarSource =
  | { kind: 'dicebear'; style: DicebearStyle; seed: string }
  | { kind: 'image'; uri: string };

export type DicebearStyle = 'funEmoji' | 'bottts' | 'adventurer';

/** The default assistant avatar. Users can re-seed for a different look. */
export const defaultAvatar: AvatarSource = {
  kind: 'dicebear',
  style: 'funEmoji',
  seed: 'xavier',
};

/** Named icons mapped to a single icon set (Lucide via @expo/vector-icons). */
export const icons = {
  home: 'home',
  dashboard: 'bar-chart-2',
  accounts: 'credit-card',
  transactions: 'list',
  settings: 'settings',
  add: 'plus',
  send: 'send',
  camera: 'camera',
  lock: 'lock',
} as const;

export type IconName = keyof typeof icons;
