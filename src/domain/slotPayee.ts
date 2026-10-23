/**
 * The slot reader's person (./slotReader) as a payee: resolved against the
 * user's own payees through D1's filter ladder (`resolvePayeeFilter`,
 * ./queryFilterResolution: exact, term memory, fuzzy / whole-word variant /
 * word prefix), trying the kin spellings of a kin word too ("mom" finds the
 * user's "Mum", "bro" finds "Brother"), else the user's own word as a new
 * payee. Used by `finishFmParse` (./fmParse: the on-device and BYOK engines)
 * and by `localParse` (the heuristic floor).
 *
 * Framework-free; BDD: tests/__features__/slot-reader.feature.
 */
import { Payee } from './types';
import { PhraseMemoryRow } from './phraseMemory';
import { resolvePayeeFilter } from './queryFilterResolution';
import { kinVariants } from './slotReader';
import { normalizeName } from './textMatch';
import { mentionedInText } from './deviceParsePrompt';

export interface SlotPayee {
  /** The payee to use: one of the user's payee names, or the user's word. */
  name: string;
  /** 'new' when no payee of the user's matched. */
  how: 'exact' | 'memory' | 'fuzzy' | 'new';
}

/**
 * The user's payee `person` names, or the word itself. A word that several
 * payees share (a union) is not a pick: the next spelling is tried, then the
 * user's own word stands (the draft card's "did you mean" still offers them).
 */
export function resolveSlotPayee(
  person: string,
  payees: readonly Payee[],
  memory: readonly PhraseMemoryRow[] = []
): SlotPayee {
  for (const term of [person, ...kinVariants(person)]) {
    const r = resolvePayeeFilter(term, payees, memory);
    if (!r || r.names.length !== 1) continue;
    if (r.how === 'exact' || r.how === 'memory' || r.how === 'fuzzy') return { name: r.names[0]!, how: r.how };
  }
  return { name: person, how: 'new' };
}

/**
 * Which payee the parse keeps: the model's, when the user literally wrote it
 * and it is neither the slot's own word (then the resolved name is the same
 * person, spelled as the user's list spells it) nor part of the purpose ("got
 * 30 from dad for taxi": "taxi" is what the money was for, not who); else the
 * slot's. `modelPayee` is the model's answer after the grounding guards.
 */
export function pickPayee(
  modelPayee: string | null,
  slot: { person: string; purpose: string | null; resolved: SlotPayee },
  text: string
): { payee: string; fromSlot: boolean } {
  if (modelPayee && mentionedInText(modelPayee, text)) {
    const m = normalizeName(modelPayee);
    const sameWord = m === normalizeName(slot.person) || m === normalizeName(slot.resolved.name);
    const inPurpose = !!slot.purpose && mentionedInText(modelPayee, slot.purpose);
    if (!sameWord && !inPurpose) return { payee: modelPayee, fromSlot: false };
  }
  const fromSlot = !modelPayee || normalizeName(modelPayee) !== normalizeName(slot.resolved.name);
  return { payee: slot.resolved.name, fromSlot };
}
