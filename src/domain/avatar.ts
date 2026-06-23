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
