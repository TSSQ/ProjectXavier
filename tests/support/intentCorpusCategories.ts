import { Category } from '../../src/domain/types';

/** The categories every intent-corpus line is classified against. Only the
 *  verbless set-budget forms ("groceries budget 450") look at them: those
 *  route for an existing category and fall through otherwise. */
export const INTENT_CORPUS_CATEGORIES: Category[] = ['Groceries', 'Dining', 'Transport'].map(
  (name) => ({ id: name.toLowerCase(), name, kind: 'expense', parentId: null, icon: null })
);
