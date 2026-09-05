/**
 * Persist a confirmed assistant draft as a real transaction.
 *
 * The public, real-repository-wired entry point every screen calls. The
 * actual sequencing — including the write-boundary guard (docs/design/
 * stale-draft-spec.md §3.1) — lives in `saveDraftSequence.ts`'s
 * `saveAssistantDraftWith`, parameterised over every native/DB-bound
 * operation so it can be exercised in the plain-Node BDD suite with a fake
 * repository (see that file's header for why: the guard being IN the
 * sequence, in the right position, needs its own test — a test against
 * `assertDraftIsSaveable` in isolation didn't catch a deleted call line).
 * This file just wires the real Drizzle repositories, `newId`, and
 * `Date.now` to it.
 */
import { TransactionDraft } from '../../domain/assistant';
import { RecurrenceRule } from '../../domain/types';
import { newId } from '../../lib/id';
import { listAccounts } from '../accounts/repository';
import { createTransaction } from '../transactions/repository';
import { createSeries, postDueOccurrences } from '../recurring/repository';
import { findOrCreateByName as findOrCreateCategory } from '../categories/repository';
import {
  findOrCreateByName as findOrCreatePayee,
  getPayeeByName,
} from '../payees/repository';
import { saveAssistantDraftWith } from './saveDraftSequence';

export async function saveAssistantDraft(
  draft: TransactionDraft,
  /** Starts a RECURRING SERIES alongside the one-off row when present — see
   *  `saveAssistantDraftWith`'s own param doc (saveDraftSequence.ts) for why. */
  repeatRule?: RecurrenceRule | null,
  /** Backfill occurrences between a past start date and today; every caller
   *  must decide (no default) — see `saveAssistantDraftWith`'s own param doc. */
  backfill = false
): Promise<string | null> {
  return saveAssistantDraftWith(
    {
      listAccounts,
      findOrCreateCategory,
      getPayeeByName,
      findOrCreatePayee,
      createSeries,
      createTransaction,
      postDueOccurrences,
      newId,
      now: Date.now,
    },
    draft,
    repeatRule,
    backfill
  );
}
