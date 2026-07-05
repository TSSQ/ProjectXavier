/**
 * Maps the assistant's runtime signals to the avatar's expression. Pure and
 * framework-free so the mapping is unit-tested and the animated component
 * (src/components/ui/XavierPet) just renders whatever state it's given.
 */
import { colors } from '../theme/tokens';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'happy' | 'confused' | 'angry';

/** The last thing that happened, used for transient reactions. */
export type AssistantOutcomeKind = 'saved' | 'spent' | 'error' | 'clarify' | null;

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
  if (lastOutcome === 'spent') return 'angry';
  if (lastOutcome === 'saved') return 'happy';
  if (lastOutcome === 'error' || lastOutcome === 'clarify') return 'confused';
  if (typing) return 'listening';
  return 'idle';
}

/**
 * The avatar is extensible by *kind*. Today there is one kind — the animated
 * "blob" (Xavier) — and the only thing the user picks within it is a colour
 * variant (the looks below). The model leaves room for future kinds (an
 * illustrated character, a Lottie/Rive animation, AI-generated art) without a
 * rewrite: every kind is a renderer that must support the AvatarStates,
 * and the component layer maps `kind → renderer` (see components/avatars).
 */
export type AvatarKind = 'blob' | 'character' | 'animated';

export interface AvatarKindDef {
  id: AvatarKind;
  label: string;
  /** Short helper line shown under the kind in Settings. */
  description: string;
  /** Whether a renderer exists yet; unavailable kinds show as "coming soon". */
  available: boolean;
}

export const AVATAR_KINDS: AvatarKindDef[] = [
  { id: 'blob', label: 'Blob', description: 'Xavier the animated pet', available: true },
];

export const DEFAULT_AVATAR_KIND: AvatarKind = 'blob';

/** Resolve a stored kind id to a kind, falling back to the default (blob).
 *  Unknown or not-yet-available kinds fall back so the UI always renders. */
export function kindById(id: string | null | undefined): AvatarKindDef {
  return AVATAR_KINDS.find((k) => k.id === id && k.available) ?? AVATAR_KINDS[0]!;
}

/** A selectable colour scheme for the blob (the body gradient + accents). This
 *  is the blob kind's "variant"; other kinds will define their own variants. */
export interface AvatarLook {
  id: string;
  label: string;
  from: string;
  to: string;
}

export const AVATAR_LOOKS: AvatarLook[] = [
  { id: 'xavier', label: 'Xavier', from: colors.primary, to: colors.primary2 },
  { id: 'mint', label: 'Mint', from: colors.positive, to: colors.teal },
  { id: 'sunset', label: 'Sunset', from: colors.negative, to: colors.amber },
  { id: 'gold', label: 'Gold', from: colors.gold, to: colors.amber },
  { id: 'grape', label: 'Grape', from: colors.primary2, to: colors.grape },
  { id: 'slate', label: 'Slate', from: '#5B7A8F', to: '#3A4F63' },
];

export const DEFAULT_AVATAR_LOOK = 'xavier';

/** Resolve a stored look id to a look, falling back to the default. */
export function lookById(id: string | null | undefined): AvatarLook {
  return AVATAR_LOOKS.find((l) => l.id === id) ?? AVATAR_LOOKS[0]!;
}
