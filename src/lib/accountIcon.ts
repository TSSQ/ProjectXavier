/**
 * Maps an account to a display emoji + Tailwind background class. Keeps the
 * account visuals consistent across the dashboard, details, and manage screens.
 */
import { Account } from '../domain/types';

export function accountIcon(a: Pick<Account, 'type' | 'subtype'>): {
  emoji: string;
  bg: string;
} {
  switch (a.subtype) {
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
      return a.type === 'asset'
        ? { emoji: '🏦', bg: 'bg-[#13314a]' }
        : { emoji: '💳', bg: 'bg-[#3a2330]' };
  }
}
