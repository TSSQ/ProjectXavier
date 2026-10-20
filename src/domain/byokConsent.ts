/**
 * BYOK consent (docs/design/byok-consent-spec.md) — App Store guideline
 * 5.1.2(i): personal data may only go to a third-party AI after clear
 * disclosure and explicit permission. Consent is per provider because the
 * recipient company changes with the provider. Pure and framework-free.
 */
import { ByokProvider } from './parseRouter';

export const BYOK_PROVIDER_NAME: Record<ByokProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/** BYOK may send user content only when the toggle is on AND the user has
 *  consented for the CURRENT provider — the consent map is indexed by
 *  `provider` here, so a caller can't pass another provider's consent. */
export function byokActive(input: {
  enabled: boolean;
  provider: ByokProvider;
  consents: Partial<Record<ByokProvider, boolean>>;
}): boolean {
  return input.enabled && input.consents[input.provider] === true;
}

/** One-time chat note for upgraders whose BYOK is enabled but unconsented. */
export const BYOK_PAUSED_NOTE_TEXT =
  'Bring your own key is paused until you allow it in Settings → Bring your own key.';

export interface ByokConsentCopy {
  title: string;
  body: string;
  allow: string;
  cancel: string;
}

export function consentCopy(provider: ByokProvider): ByokConsentCopy {
  const name = BYOK_PROVIDER_NAME[provider];
  return {
    title: `Send expenses to ${name}?`,
    body: `When this is on, what you type to Xavier — plus your account, category and payee names, and for questions the matching transactions and balances — goes to ${name} using your own API key, under your account with them. Their terms and data retention apply, not ours. Xavier still works on-device if you turn this off.`,
    allow: 'Allow',
    cancel: 'Not now',
  };
}
