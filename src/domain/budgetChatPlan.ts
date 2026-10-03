/**
 * What an Assistant budget command does once its category is known
 * (docs/design/monthly-budgets-spec.md §6.1, chat amendment): a confirm card
 * for a set, an edit or a removal, or a plain reply when there is nothing to
 * confirm. Pure: the screen asks the plan, shows it, and writes only after the
 * user taps Confirm. Amounts are minor units.
 */
import { MonthKey } from './budgets';
import { toMinorUnits } from './money';
import { EditBudgetIntent, RemoveBudgetIntent, SetBudgetIntent } from './budgetIntent';
import {
  alreadyBudgetText,
  belowZeroText,
  deltaMissingBudgetText,
  editDeltaConfirmText,
  editMissingBudgetText,
  noBudgetText,
  oneOffOnlyText,
  removeBudgetConfirmText,
  setBudgetConfirmText,
} from './budgetCopy';

/** One user-stated change, amounts converted to minor units. */
export type BudgetChatAction =
  | { kind: 'set'; amount: number }
  | { kind: 'edit-to'; amount: number }
  | { kind: 'edit-by'; direction: 'raise' | 'lower'; amount: number }
  | { kind: 'remove' };

/** The repository write a confirmed plan makes: always "this month onward", as
 *  the set-budget card has always said. A removal is a NULL-amount row (the
 *  tombstone the schema already defines), so earlier months keep their budget. */
export interface BudgetChatWrite {
  amount: number | null;
  scope: 'onward';
}

export type BudgetChatPlan =
  | { kind: 'confirm-set'; current: number | null; next: number; text: string; write: BudgetChatWrite }
  | { kind: 'confirm-remove'; current: number; text: string; write: BudgetChatWrite }
  | { kind: 'reply'; text: string };

/** The intent's change, with its major-unit amounts converted to minor units
 *  at the currency's own exponent. */
export function chatActionOf(
  intent: SetBudgetIntent | EditBudgetIntent | RemoveBudgetIntent,
  currency: string
): BudgetChatAction {
  if (intent.kind === 'remove-budget') return { kind: 'remove' };
  if (intent.kind === 'set-budget') return { kind: 'set', amount: toMinorUnits(intent.amount, currency) };
  const { change } = intent;
  return change.mode === 'to'
    ? { kind: 'edit-to', amount: toMinorUnits(change.amount, currency) }
    : { kind: 'edit-by', direction: change.direction, amount: toMinorUnits(change.amount, currency) };
}

export function planBudgetChat(args: {
  action: BudgetChatAction;
  categoryName: string;
  /** The budget in force this month (a one-off included), or null for none. */
  current: number | null;
  /** The ongoing (open-ended) amount a delta builds on, or null for none. */
  ongoing: number | null;
  month: MonthKey;
  currency: string;
}): BudgetChatPlan {
  const { action, categoryName, current, ongoing, month, currency } = args;
  switch (action.kind) {
    case 'remove':
      return current === null
        ? { kind: 'reply', text: noBudgetText(categoryName) }
        : {
            kind: 'confirm-remove',
            current,
            text: removeBudgetConfirmText({ categoryName, current, currency }),
            write: { amount: null, scope: 'onward' },
          };
    case 'edit-by': {
      // The write is "onward", so a delta builds on the ongoing amount, not on
      // a one-off that the write replaces; the text says so.
      if (ongoing === null) {
        return {
          kind: 'reply',
          text:
            current === null
              ? deltaMissingBudgetText(categoryName)
              : oneOffOnlyText({ categoryName, oneOff: current, month, currency }),
        };
      }
      const next = action.direction === 'raise' ? ongoing + action.amount : ongoing - action.amount;
      if (next <= 0) {
        return {
          kind: 'reply',
          text: belowZeroText({ categoryName, delta: action.amount, current: ongoing, currency }),
        };
      }
      return {
        kind: 'confirm-set',
        current: ongoing,
        next,
        text: editDeltaConfirmText({
          categoryName,
          direction: action.direction,
          delta: action.amount,
          current: ongoing,
          next,
          month,
          currency,
          ...(current !== null && current !== ongoing ? { oneOff: current } : {}),
        }),
        write: { amount: next, scope: 'onward' },
      };
    }
    case 'edit-to':
    case 'set': {
      if (current === action.amount) {
        return { kind: 'reply', text: alreadyBudgetText({ categoryName, amount: current, currency }) };
      }
      const text =
        current === null && action.kind === 'edit-to'
          ? editMissingBudgetText({ categoryName, next: action.amount, month, currency })
          : setBudgetConfirmText({ categoryName, current, next: action.amount, month, currency });
      return {
        kind: 'confirm-set',
        current,
        next: action.amount,
        text,
        write: { amount: action.amount, scope: 'onward' },
      };
    }
  }
}
