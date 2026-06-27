/**
 * Maps an account to a display emoji + Tailwind background class. Keeps the
 * account visuals consistent across the dashboard, details, and manage screens.
 *
 * When the account has an explicit `icon`, that emoji is used. Otherwise the
 * emoji falls back to the subtype-derived default. The background colour is
 * always derived from `subtype` (never overridden by the icon choice).
 */
import { Account } from '../domain/types';

export function accountIcon(a: Pick<Account, 'subtype' | 'icon'>): {
  emoji: string;
  bg: string;
} {
  const subtypeResult = subtypeIcon(a.subtype);
  const emoji = a.icon || subtypeResult.emoji;
  return { emoji, bg: subtypeResult.bg };
}

function subtypeIcon(subtype: string | undefined): { emoji: string; bg: string } {
  switch (subtype) {
    case 'cash':
      return { emoji: '💵', bg: 'bg-[#1c3a2e]' };
    case 'bank':
      return { emoji: '🏦', bg: 'bg-[#13314a]' };
    case 'credit_card':
      return { emoji: '💳', bg: 'bg-[#3a2330]' };
    case 'loan':
      return { emoji: '🏛️', bg: 'bg-[#3a2330]' };
    case 'investment':
      return { emoji: '📈', bg: 'bg-[#2a2350]' };
    default:
      return { emoji: '👛', bg: 'bg-[#13314a]' };
  }
}
