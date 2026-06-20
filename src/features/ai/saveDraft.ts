/**
 * Persist a confirmed assistant draft as a real transaction.
 *
 * Resolves the draft's free-text category/payee names to ids (creating them if
 * new), assembles a Transaction via the pure domain helper, and writes it
 * through the validated, parameterised repository. Returns the saved id.
 */
import { TransactionDraft, buildTransaction } from '../../domain/assistant';
import { newId } from '../../lib/id';
import { createTransaction } from '../transactions/repository';
import { findOrCreateByName as findOrCreateCategory } from '../categories/repository';
import { findOrCreateByName as findOrCreatePayee } from '../payees/repository';

export async function saveAssistantDraft(
  draft: TransactionDraft
): Promise<string> {
  const categoryId = draft.categoryName
    ? await findOrCreateCategory(draft.categoryName, draft.type)
    : null;
  const payeeId = draft.payeeName
    ? await findOrCreatePayee(draft.payeeName)
    : null;

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
