/**
 * Persist a confirmed assistant draft as a real transaction.
 *
 * Resolves the draft's free-text category/payee names to ids and applies the
 * payee↔category rules:
 *  - A brand-new payee is created silently and adopts the draft's category as
 *    its first-used default.
 *  - An existing payee with no explicit category contributes its learned
 *    default ("prefer learned default").
 * Then assembles a Transaction via the pure domain helper and writes it through
 * the validated, parameterised repository. Returns the saved id.
 */
import { TransactionDraft, buildTransaction } from '../../domain/assistant';
import { resolveCategoryId } from '../../domain/payees';
import { newId } from '../../lib/id';
import { createTransaction } from '../transactions/repository';
import { findOrCreateByName as findOrCreateCategory } from '../categories/repository';
import {
  findOrCreateByName as findOrCreatePayee,
  getPayeeByName,
} from '../payees/repository';

export async function saveAssistantDraft(
  draft: TransactionDraft
): Promise<string> {
  const explicitCategoryId = draft.categoryName
    ? await findOrCreateCategory(draft.categoryName, draft.type)
    : null;

  let payeeId: string | null = null;
  let categoryId = explicitCategoryId;

  if (draft.payeeName) {
    const existing = await getPayeeByName(draft.payeeName);
    // No explicit category? fall back to the payee's learned default.
    categoryId = resolveCategoryId(explicitCategoryId, existing);
    payeeId = existing
      ? existing.id
      : // New payee: remember this category as its first-used default.
        await findOrCreatePayee(draft.payeeName, categoryId);
  }

  const tx = buildTransaction(draft, {
    id: newId(),
    createdAt: Date.now(),
    categoryId,
    payeeId,
  });

  // createTransaction validates with zod and inserts via bound parameters.
  await createTransaction(tx);
  return tx.id;
}
