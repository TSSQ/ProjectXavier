/**
 * "A restore replaced the database" signal (docs/design/xavier-daily-chat-spec.md
 * §5, §6.1). A restore clears the chat rows inside its transaction, so the
 * Assistant's in-memory log has to follow. The backup screen announces it; the
 * chat hook listens. Neither imports the other, so the backup feature never
 * depends on a screen. Pure and framework-free.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Returns the unsubscribe function. */
export function subscribeChatRestored(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called once a restore has completed. A throwing listener never blocks the others. */
export function notifyChatRestored(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener's failure is its own; the restore itself already succeeded.
    }
  }
}
