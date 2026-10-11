/**
 * The write side of phrase memory (src/domain/phraseMemory.ts), as a
 * sequence over an injected store so it is BDD-tested in plain Node with a
 * fake (tests/__features__/phrase-memory.feature); ./repository.ts wires the
 * real Drizzle store. Every entry point is BEST-EFFORT: a failure is
 * swallowed with a content-free warning (never the user's words), because
 * each one runs after something the user already did (a save, a discard, a
 * "Log anyway") and must never turn that into an error.
 */
import {
  PhraseMemoryRow,
  PhraseVerdict,
  ConfirmedFields,
  PHRASE_MEMORY_CAP,
  phraseKey,
  memoryPatch,
  verdictPatch,
  revertPatch,
  evictionKeys,
} from '../../domain/phraseMemory';

/** The storage a phrase-memory write needs. Every query is parameterised in
 *  the real implementation (./repository.ts). */
export interface PhraseMemoryStore {
  get(key: string): Promise<PhraseMemoryRow | null>;
  put(row: PhraseMemoryRow): Promise<void>;
  remove(key: string): Promise<void>;
  /** Every row's key and recency, for eviction. */
  list(): Promise<PhraseMemoryRow[]>;
}

async function bestEffort(what: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch {
    // Content-free on purpose: no key, no text, no ids.
    console.warn(`phraseMemory: could not ${what}`);
  }
}

async function putAndEvict(store: PhraseMemoryStore, row: PhraseMemoryRow, cap: number): Promise<void> {
  await store.put(row);
  for (const key of evictionKeys(await store.list(), cap)) await store.remove(key);
}

/** The user saved (or edited a saved AI transaction to) `fields` for `text`. */
export function rememberConfirmed(
  store: PhraseMemoryStore,
  text: string,
  fields: ConfirmedFields,
  now: number,
  cap: number = PHRASE_MEMORY_CAP
): Promise<void> {
  return bestEffort('remember a confirmed parse', async () => {
    const key = phraseKey(text, now);
    if (!key) return;
    const row = memoryPatch(key, fields, await store.get(key), now);
    if (row) await putAndEvict(store, row, cap);
  });
}

/** "Log anyway" ('log') or a discarded code-affirmed draft ('not_log'). */
export function rememberVerdict(
  store: PhraseMemoryStore,
  text: string,
  verdict: PhraseVerdict,
  now: number,
  cap: number = PHRASE_MEMORY_CAP
): Promise<void> {
  return bestEffort('remember a verdict', async () => {
    const key = phraseKey(text, now);
    if (!key) return;
    const row = verdictPatch(key, verdict, await store.get(key), now);
    if (row) await putAndEvict(store, row, cap);
  });
}

/** The user reverted a field the memory under `key` applied. */
export function rememberRevert(store: PhraseMemoryStore, key: string, now: number): Promise<void> {
  return bestEffort('count a revert', async () => {
    const previous = await store.get(key);
    if (!previous) return;
    const next = revertPatch(previous, now);
    if (next === 'delete') await store.remove(key);
    else await store.put(next);
  });
}

/** A memory was just applied to a draft: it is now the most recently used. */
export function touchMemory(store: PhraseMemoryStore, key: string, now: number): Promise<void> {
  return bestEffort('touch a memory', async () => {
    const previous = await store.get(key);
    if (previous) await store.put({ ...previous, lastUsedAt: now });
  });
}
