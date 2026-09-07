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
  keyboard: 'type',
} as const;

export type IconName = keyof typeof icons;

/** Icon glyph sizes for the glass family components (glass-standard spec
 *  S0): sm captions and pill glyphs, md rows/controls/in-field, lg the FAB
 *  and `lg` icon buttons. No literal icon size outside this scale on a
 *  migrated call site — see glass-standard.feature scenario 4. */
export const ICON = { sm: 14, md: 18, lg: 24 } as const;
