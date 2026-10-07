/**
 * VoiceOver announcements for the chat feed: a new Xavier message is spoken
 * when a screen reader is on (the list does not announce inserted rows itself).
 */
import { AccessibilityInfo } from 'react-native';
import type { ChatMessage } from '../../domain/chatMessage';

/** The words of a Xavier bubble, for the screen reader. */
export function spokenText(m: ChatMessage): string | null {
  if (m.kind === 'xavier_text') return m.payload.text;
  if (m.kind === 'xavier_receipt') return [m.payload.headline, ...m.payload.lines].join('. ');
  return null;
}

/** Speaks every Xavier message in `added`, whatever else arrived with it. */
export function announceIncoming(added: readonly ChatMessage[]): void {
  const text = added
    .map(spokenText)
    .filter((x): x is string => !!x)
    .join(' ');
  if (!text) return;
  void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
    if (on) AccessibilityInfo.announceForAccessibility(`Xavier: ${text}`);
  });
}
