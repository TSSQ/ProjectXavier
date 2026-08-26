/**
 * Persist a confirmed assistant draft as a real transaction.
 *
 * Resolves the draft's free-text category/payee names to ids and applies the
 * payee↔category rules:
 *  - A brand-new payee is created silently and adopts the draft's category as
 *    its first-used default.
 *  - An existing payee with no explicit category contributes its learned
 *    default ("prefer learned default").
 * Transfers have neither (interpret() always sets both null — see
 * TransactionDraft), so that machinery is skipped entirely for them.
 * Then assembles a Transaction via the pure domain helper and writes it through
 * the validated, parameterised repository. Returns the saved id.
 */
import { TransactionDraft, buildTransaction } from '../../domain/assistant';
import { resolveCategoryId } from '../../domain/payees';
import { buildRecurringSeries } from '../../domain/recurrence';
import { RecurrenceRule } from '../../domain/types';
import { newId } from '../../lib/id';
import { createTransaction } from '../transactions/repository';
import { createSeries, postDueOccurrences } from '../recurring/repository';
import { findOrCreateByName as findOrCreateCategory } from '../categories/repository';
import {
  findOrCreateByName as findOrCreatePayee,
  getPayeeByName,
} from '../payees/repository';

export async function saveAssistantDraft(
  draft: TransactionDraft,
  /** When present, the draft starts a RECURRING SERIES instead of a one-off:
   *  a schedule is created ALONGSIDE the transaction — the row is still
   *  written and returned, now tagged with the series. Same behaviour the
   *  transactions FAB has; the assistant's editor simply had nowhere to put a
   *  repeat rule, so its form hid the control (see `showRepeat`). */
  repeatRule?: RecurrenceRule | null,
  /** Create the occurrences between a PAST start date and today. The assistant
   *  screen asks before setting this — see app/(tabs)/index.tsx. No default:
   *  every caller must decide, and typecheck names the ones that have not. */
  backfill = false
): Promise<string | null> {
  let categoryId: string | null = null;
  let payeeId: string | null = null;
  let seriesId: string | null = null;
  let occurrenceDate: number | null = null;

  if (draft.type !== 'transfer') {
    const explicitCategoryId = draft.categoryName
      ? await findOrCreateCategory(draft.categoryName, draft.type)
      : null;
    categoryId = explicitCategoryId;

    if (draft.payeeName) {
      const existing = await getPayeeByName(draft.payeeName);
      // No explicit category? fall back to the payee's learned default.
      categoryId = resolveCategoryId(explicitCategoryId, existing);
      payeeId = existing
        ? existing.id
        : // New payee: remember this category as its first-used default.
          await findOrCreatePayee(draft.payeeName, categoryId);
    }
  }

  if (repeatRule) {
    // A repeat rule adds a SCHEDULE; it does not replace the transaction the
    // user just confirmed. The row is still created below, tagged with the
    // series, and the schedule runs from there — see buildRecurringSeries for
    // why the poster must not mint that first occurrence itself.
    const series = buildRecurringSeries({
      id: newId(),
      rule: repeatRule,
      occurredAt: draft.occurredAt,
      createdAt: Date.now(),
      // This used to be hardcoded false, on the reasoning that a confirm-card
      // flow is the wrong place to ask about months of history — and that the
      // charges could be added later from the transactions screen instead.
      // That second half was simply wrong: the transactions screen only asks
      // while CREATING a series, so there was no way back. Reported from the
      // beta by someone who set a 2025 date in Xavier's editor, got no prompt,
      // and no earlier charges. The editor is where the date was chosen, so
      // the editor is where the question belongs.
      backfill,
      template: {
        accountId: draft.accountId,
        type: draft.type,
        amount: draft.amount,
        currency: draft.currency,
        categoryId,
        payeeId,
        transferAccountId: draft.transferAccountId ?? null,
        note: draft.note,
      },
    });
    await createSeries(series);
    seriesId = series.id;
    occurrenceDate = series.rule.anchor;
    // postDueOccurrences deliberately runs AFTER the transaction below, not
    // here — see the note at the call site.
  }

  const tx = buildTransaction(draft, {
    id: newId(),
    createdAt: Date.now(),
    categoryId,
    payeeId,
  });

  // createTransaction validates with zod and inserts via bound parameters.
  await createTransaction(seriesId ? { ...tx, seriesId, occurrenceDate } : tx);

  // Only now is it safe to post. postDueOccurrences skips an occurrence when a
  // row already exists for (seriesId, occurrenceDate), and this row IS the
  // anchor occurrence — so running it before the insert means the guard has
  // nothing to find, the poster mints the anchor itself, and the insert then
  // adds a second row on the same day.
  //
  // That stayed hidden while backfill was hardcoded false: the series carried
  // lastPostedAt = max(anchor, today) and postedCount 1, so nothing was ever
  // due at the anchor. Turning backfill on made the anchor due and the
  // duplicate appeared immediately — reported from beta 80 as two Disney and
  // three Netflix rows stacked on one day.
  //
  // app/(tabs)/transactions.tsx has always had this order; this file did not.
  if (seriesId) await postDueOccurrences(Date.now());
  return tx.id;
}
