/**
 * Maps the assistant's runtime signals to the avatar's expression. Pure and
 * framework-free so the mapping is unit-tested and the animated component
 * (src/components/ui/XavierPet) just renders whatever state it's given.
 */

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'happy' | 'confused';

/** The last thing that happened, used for transient reactions. */
export type AssistantOutcomeKind = 'saved' | 'error' | 'clarify' | null;

export interface AssistantSignals {
  /** A parse/save is in flight. */
  busy: boolean;
  /** The user is composing input (or the camera is open). */
  typing: boolean;
  /** The most recent outcome (cleared by the screen after a beat). */
  lastOutcome?: AssistantOutcomeKind;
}

/**
 * Priority: a in-flight request (thinking) wins, then a transient outcome
 * (happy/confused), then active input (listening), otherwise idle.
 */
export function avatarStateFor({
  busy,
  typing,
  lastOutcome = null,
}: AssistantSignals): AvatarState {
  if (busy) return 'thinking';
  if (lastOutcome === 'saved') return 'happy';
  if (lastOutcome === 'error' || lastOutcome === 'clarify') return 'confused';
  if (typing) return 'listening';
  return 'idle';
}

/** A selectable colour scheme for the pet (the body gradient + accents). */
export interface AvatarLook {
  id: string;
  label: string;
  from: string;
  to: string;
}

export const AVATAR_LOOKS: AvatarLook[] = [
  { id: 'xavier', label: 'Xavier', from: '#5B8DEF', to: '#7C5BEF' },
  { id: 'mint', label: 'Mint', from: '#33C27F', to: '#2BB6A8' },
  { id: 'sunset', label: 'Sunset', from: '#F2637E', to: '#E0884B' },
  { id: 'gold', label: 'Gold', from: '#E0B84B', to: '#E0884B' },
  { id: 'grape', label: 'Grape', from: '#7C5BEF', to: '#B05BEF' },
  { id: 'slate', label: 'Slate', from: '#5B7A8F', to: '#3A4F63' },
];

export const DEFAULT_AVATAR_LOOK = 'xavier';

/** Resolve a stored look id to a look, falling back to the default. */
export function lookById(id: string | null | undefined): AvatarLook {
  return AVATAR_LOOKS.find((l) => l.id === id) ?? AVATAR_LOOKS[0]!;
}
