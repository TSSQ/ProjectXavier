/**
 * The Assistant's budget answers (docs/design/monthly-budgets-spec.md §6),
 * extracted from app/(tabs)/index.tsx: the afford card and its "which budget?"
 * chips, the set-budget confirm, "Raise <category> budget", and the chip a
 * saved expense gains. One card at a time, like the other answer states. The
 * sentence goes through `setReply`; every figure comes from the budget domain.
 *
 * Every card remembers the data revision it was built against, and the screen
 * drops it (`dropStaleReply`) when the ledger has moved on underneath it.
 */
import { useCallback, useRef, useState } from 'react';
import { Account, Category, Payee, Transaction } from '../../domain/types';
import { AssistantOutcomeKind } from '../../domain/avatar';
import { formatMoney } from '../../domain/money';
import { dateLabelFor } from '../../domain/dates';
import {
  BudgetIntent,
  AffordIntent,
  affordLogText,
  resolveBudgetCategory,
} from '../../domain/budgetIntent';
import { resolveForCommand } from '../../domain/budgetCategoryCreate';
import { BudgetChatAction, BudgetChatWrite, chatActionOf, planBudgetChat } from '../../domain/budgetChatPlan';
import { AffordPlan, PickOption, planAfford } from '../../domain/affordPlan';
import {
  BudgetSummary,
  BudgetScope,
  MonthKey,
  budgetFor,
  budgetableCategories,
  computeBudgets,
  ongoingBudgetFor,
  monthKeyOf,
  topLevelCategoryId,
} from '../../domain/budgets';
import {
  SavedChip,
  savedChip,
  budgetClarifyText,
  createCategoryDoneText,
  createCategoryOfferText,
  noCategoryText,
  removeBudgetDoneText,
  setBudgetDoneText,
  titleCase,
} from '../../domain/budgetCopy';
import {
  checkSetBudgetConfirm,
  isStaleBudgetReply,
  setBudgetRefusalText,
} from '../../domain/budgetReplyGuard';
import { BudgetEditTarget } from '../../components/budgets/BudgetEditSheet';
import { listTransactions, getTransaction } from '../transactions/repository';
import { listSeries } from '../recurring/repository';
import { listCategories } from '../categories/repository';
import { getCurrency, getDataRevision } from '../settings/repository';
import { listBudgetRows, setBudget } from './repository';
import { createCategoryWithBudget } from './createCategoryBudget';

/** What the Assistant is showing in answer to a budget intent. */
export type BudgetReply = { dataRevision: number } & (
  | { kind: 'afford'; intent: AffordIntent; plan: Extract<AffordPlan, { kind: 'answer' }>; summary: BudgetSummary }
  | { kind: 'afford-pick'; intent: AffordIntent; options: PickOption[] }
  | { kind: 'no-budgets' }
  | { kind: 'budget-unknown' }
  | {
      kind: 'set-budget';
      category: Category;
      current: number | null;
      next: number;
      month: MonthKey;
      /** The currency `next` was converted to minor units in. */
      currency: string;
    }
  | {
      kind: 'set-budget-suggest';
      category: Category;
      action: BudgetChatAction;
      /** The typed name for the [Create "Name"] button; null = no such button. */
      createName: string | null;
      currency: string;
    }
  | { kind: 'create-category'; name: string; next: number; month: MonthKey; currency: string }
  | {
      kind: 'remove-budget';
      category: Category;
      current: number;
      month: MonthKey;
      currency: string;
      /** The write Remove makes, from the plan. */
      write: BudgetChatWrite;
    }
);

export interface SavedBudgetState {
  title: string;
  amountText: string;
  meta: string;
  chip: SavedChip;
}

export interface BudgetEditState {
  target: BudgetEditTarget;
  month: MonthKey;
}

export interface BudgetRepliesDeps {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setReply: (text: string) => void;
  setLastOutcome: (outcome: AssistantOutcomeKind) => void;
  /** The idle greeting a dismissed card returns the reply to. */
  greeting: string;
  currency: string;
  categories: Category[];
  payees: Payee[];
  accounts: Account[];
  /** The screen's parse entry point ("Log it" runs it, forced as an expense). */
  runParse: (text: string, options?: { forceExpense?: boolean }) => Promise<void>;
}

const SAVE_FAILED = "I couldn't save that budget — please try again.";

export function useBudgetReplies(deps: BudgetRepliesDeps) {
  const { busy, setBusy, setReply, setLastOutcome, greeting, currency, categories, payees, accounts } =
    deps;
  const [reply, setReplyState] = useState<BudgetReply | null>(null);
  const [edit, setEdit] = useState<BudgetEditState | null>(null);
  const [saved, setSaved] = useState<SavedBudgetState | null>(null);
  // Mirror for the focus-time staleness check (a callback keyed on nothing
  // cannot read the state it closed over).
  const replyRef = useRef<BudgetReply | null>(null);
  const setCard = useCallback((next: BudgetReply | null) => {
    replyRef.current = next;
    setReplyState(next);
  }, []);
  /** The category an afford "Log it" presets on the draft it opens; consumed
   *  by the next parse. */
  const presetCategoryRef = useRef<{ id: string; name: string } | null>(null);

  const idle = () => {
    setCard(null);
    setSaved(null);
    setReply(greeting);
  };

  /** A new message replaces whatever budget card was showing. */
  const clear = () => {
    setCard(null);
    setSaved(null);
  };

  /** Drops the card (and its reply) when the data revision has moved on since
   *  it was built. Returns whether it did. */
  const dropStaleReply = useCallback(
    (revision: number): boolean => {
      const current = replyRef.current;
      if (!current || !isStaleBudgetReply(current.dataRevision, revision)) return false;
      setCard(null);
      return true;
    },
    [setCard]
  );

  const fail = (text: string) => {
    setReply(text);
    setLastOutcome('error');
  };

  const loadSummary = async (cats: Category[], now: number, month: MonthKey = monthKeyOf(now)) => {
    const [txs, series, rows, dataRevision] = await Promise.all([
      listTransactions(),
      listSeries(),
      listBudgetRows(),
      getDataRevision(),
    ]);
    return {
      rows,
      dataRevision,
      summary: computeBudgets({
        transactions: txs,
        series: series.filter((x) => !x.archived),
        categories: cats,
        rows,
        now,
        month,
      }),
    };
  };

  const showPlan = (intent: AffordIntent, plan: AffordPlan, summary: BudgetSummary, rev: number) => {
    setReply(plan.text);
    if (plan.kind === 'answer') setCard({ kind: 'afford', intent, plan, summary, dataRevision: rev });
    else if (plan.kind === 'pick') setCard({ kind: 'afford-pick', intent, options: plan.options, dataRevision: rev });
    else setCard({ kind: 'no-budgets', dataRevision: rev });
  };

  /** Plans the chat action for a resolved category and shows what it needs:
   *  a confirm card (set / edit / remove) or a plain reply. */
  const openPlan = (
    category: Category,
    action: BudgetChatAction,
    rows: Awaited<ReturnType<typeof listBudgetRows>>,
    now: number,
    rev: number
  ) => {
    const month = monthKeyOf(now);
    const current = budgetFor(rows, category.id, month);
    const ongoing = ongoingBudgetFor(rows, category.id, month);
    const plan = planBudgetChat({ action, categoryName: category.name, current, ongoing, month, currency });
    setReply(plan.text);
    if (plan.kind === 'confirm-set') {
      setCard({ kind: 'set-budget', category, current: plan.current, next: plan.next, month, currency, dataRevision: rev });
    } else if (plan.kind === 'confirm-remove') {
      setCard({ kind: 'remove-budget', category, current: plan.current, month, currency, write: plan.write, dataRevision: rev });
    } else {
      setCard(null);
      setLastOutcome('clarify');
    }
  };

  /** Answers a budget intent from runParse's gate. */
  const answerIntent = async (intent: BudgetIntent, cats: Category[], pays: Payee[], now: number) => {
    try {
      const { rows, summary, dataRevision } = await loadSummary(cats, now);
      if (intent.kind === 'afford') {
        showPlan(
          intent,
          planAfford(intent, { categories: cats, payees: pays, summary, now, currency }),
          summary,
          dataRevision
        );
        return;
      }
      if (intent.kind === 'budget-clarify') {
        await answerClarify(intent, cats, dataRevision);
        return;
      }
      const action = chatActionOf(intent, currency);
      const found = resolveForCommand(intent, cats);
      if (found.kind === 'reply') {
        setReply(found.text);
        // A set-budget with a name that cannot be a category keeps "Open Budget".
        setCard(intent.kind === 'set-budget' ? { kind: 'budget-unknown', dataRevision } : null);
        setLastOutcome('clarify');
        return;
      }
      if (found.kind === 'offer-create') {
        offerCreate(found.name, action, now, dataRevision);
        return;
      }
      // A near-miss spelling, or a model-picked category the text never names,
      // is checked with the user first.
      if (found.kind === 'suggest') {
        setReply(`Did you mean ${found.category.name}?`);
        setCard({
          kind: 'set-budget-suggest',
          category: found.category,
          action,
          createName: found.createName,
          currency,
          dataRevision,
        });
        return;
      }
      openPlan(found.category, action, rows, now, dataRevision);
    } catch {
      fail("I couldn't work that out — please try again.");
    }
  };

  /** "You don't have a Pets category yet. Create it with a $300 monthly budget?" */
  const offerCreate = (name: string, action: BudgetChatAction, now: number, rev: number) => {
    if (action.kind !== 'set') return;
    setReply(createCategoryOfferText({ name, amount: action.amount, currency }));
    setCard({ kind: 'create-category', name, next: action.amount, month: monthKeyOf(now), currency, dataRevision: rev });
  };

  /** A command with a slot missing, or wording nobody could read: a question
   *  or a hint, never a guess. */
  const answerClarify = async (
    intent: Extract<BudgetIntent, { kind: 'budget-clarify' }>,
    cats: Category[],
    dataRevision: number
  ) => {
    const exactName =
      intent.categoryName === undefined
        ? undefined
        : resolveBudgetCategory(intent.categoryName, cats);
    if (exactName?.kind === 'none') {
      // Edit and remove never offer to create the category.
      const noOffer = intent.action === 'edit' || intent.action === 'remove';
      setReply(
        noOffer
          ? noCategoryText(titleCase(intent.categoryName!))
          : `I couldn't find a ${titleCase(intent.categoryName!)} category.`
      );
      setCard(noOffer ? null : { kind: 'budget-unknown', dataRevision });
    } else {
      setReply(
        budgetClarifyText({
          missing: intent.missing,
          categoryName: exactName ? exactName.category.name : undefined,
          example: budgetableCategories(cats)[0]?.name ?? 'food',
        })
      );
      setCard(null);
    }
    setLastOutcome('clarify');
  };

  const onSuggestionYes = async () => {
    if (reply?.kind !== 'set-budget-suggest' || busy) return;
    try {
      const { category, action } = reply;
      const { rows, dataRevision } = await loadSummary(categories, Date.now());
      openPlan(category, action, rows, Date.now(), dataRevision);
    } catch {
      fail("I couldn't work that out — please try again.");
    }
  };

  /** [Create "Dinning"] on a "did you mean" card: on to the create offer. */
  const onSuggestionCreate = async () => {
    if (reply?.kind !== 'set-budget-suggest' || busy || !reply.createName) return;
    offerCreate(reply.createName, reply.action, Date.now(), reply.dataRevision);
  };

  const onConfirmCreateCategory = async () => {
    if (reply?.kind !== 'create-category' || busy) return;
    const { name, next, month, currency: builtIn } = reply;
    setBusy(true);
    try {
      if (builtIn !== (await getCurrency())) {
        setCard(null);
        fail(setBudgetRefusalText('currency-changed'));
        return;
      }
      await createCategoryWithBudget({ name, amount: next, month });
      setCard(null);
      setReply(createCategoryDoneText({ name, amount: next, month, currency }));
      setLastOutcome('saved');
    } catch {
      fail(SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const onConfirmSetBudget = async () => {
    if (reply?.kind !== 'set-budget' || busy) return;
    const { category, next, month, currency: builtIn } = reply;
    setBusy(true);
    try {
      // The category may have been deleted, or the currency relabelled, while
      // the card sat there.
      const check = checkSetBudgetConfirm({
        categoryId: category.id,
        currency: builtIn,
        currentCurrency: await getCurrency(),
        categories: await listCategories(),
      });
      if (check !== 'ok') {
        setCard(null);
        fail(setBudgetRefusalText(check));
        return;
      }
      await setBudget({ categoryId: category.id, amount: next, month, scope: 'onward' });
      setCard(null);
      setReply(setBudgetDoneText({ categoryName: category.name, next, month, currency }));
      setLastOutcome('saved');
    } catch {
      fail(SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const onConfirmRemoveBudget = async () => {
    if (reply?.kind !== 'remove-budget' || busy) return;
    const { category, month, currency: builtIn, write } = reply;
    setBusy(true);
    try {
      const check = checkSetBudgetConfirm({
        categoryId: category.id,
        currency: builtIn,
        currentCurrency: await getCurrency(),
        categories: await listCategories(),
      });
      if (check !== 'ok') {
        setCard(null);
        fail(setBudgetRefusalText(check));
        return;
      }
      await setBudget({ categoryId: category.id, amount: write.amount, month, scope: write.scope });
      setCard(null);
      setReply(removeBudgetDoneText({ categoryName: category.name, month }));
      setLastOutcome('saved');
    } catch {
      fail(SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (scope: string) => {
    if (reply?.kind !== 'afford-pick' || busy) return;
    try {
      const { intent } = reply;
      const now = Date.now();
      const { summary, dataRevision } = await loadSummary(categories, now);
      showPlan(intent, planAfford(intent, { categories, payees, summary, now, currency }, scope), summary, dataRevision);
    } catch {
      fail("I couldn't work that out — please try again.");
    }
  };

  /** "Log it": the existing draft/confirm flow on the same words with the
   *  afford cue stripped, the amount stated explicitly, and the budget's
   *  category preset. Nothing is logged without that confirm. */
  const onLog = async () => {
    if (reply?.kind !== 'afford' || busy) return;
    const { intent, plan } = reply;
    setCard(null);
    presetCategoryRef.current =
      plan.categoryName === null ? null : { id: plan.scope, name: plan.categoryName };
    await deps.runParse(affordLogText(intent), { forceExpense: true });
  };

  /** "Raise <category> budget": re-reads the live budget, so a budget edited
   *  while the card sat there is raised from its real value. */
  const onRaise = async () => {
    if (reply?.kind !== 'afford' || !reply.plan.view) return;
    const { plan } = reply;
    try {
      const { summary } = await loadSummary(categories, Date.now());
      const cat = categories.find((x) => x.id === plan.scope);
      const live = summary.categories.find((v) => v.categoryId === plan.scope);
      if (!cat || !live) {
        setCard(null);
        fail(`${cat?.name ?? 'That category'} has no budget any more.`);
        return;
      }
      setEdit({
        month: plan.month,
        target: {
          categoryId: cat.id,
          name: cat.name,
          icon: cat.icon ?? null,
          current: live.budget,
          // The live budget plus the live overage: exactly enough to fit it.
          seed: live.budget + Math.max(0, plan.amount - live.left),
        },
      });
    } catch {
      fail("I couldn't work that out — please try again.");
    }
  };

  const onEditSave = async (categoryId: string, amount: number | null, scope: BudgetScope) => {
    if (!edit) return;
    const { month } = edit;
    const name = categories.find((x) => x.id === categoryId)?.name ?? 'Category';
    setEdit(null);
    try {
      await setBudget({ categoryId, amount, month, scope });
      setCard(null);
      setReply(
        amount === null
          ? `Removed the ${name} budget.`
          : setBudgetDoneText({ categoryName: name, next: amount, month, currency })
      );
      setLastOutcome('saved');
    } catch {
      fail(SAVE_FAILED);
    }
  };

  /**
   * After an expense saves, adds the budget chip (spec §6.4): what is left in
   * its top-level category's budget for the transaction's month. The category
   * comes from the SAVED transaction (`txId`), not from re-matching a name.
   * Best effort — a failure here never disturbs a save that already succeeded.
   */
  const showSavedChip = async (
    draft: { type: string; payeeName: string | null; note: string | null },
    txId: string | null
  ) => {
    if (draft.type !== 'expense' || !txId) return;
    try {
      const tx: Transaction | null = await getTransaction(txId);
      if (!tx?.categoryId) return;
      const now = Date.now();
      const cats = await listCategories();
      const cat = cats.find((x) => x.id === tx.categoryId);
      if (!cat) return;
      const byId = new Map(cats.map((x) => [x.id, x]));
      const topId = topLevelCategoryId(cat.id, byId);
      const top = topId ? byId.get(topId) : undefined;
      if (!top) return;
      const month = monthKeyOf(tx.occurredAt);
      const { summary: monthSummary } = await loadSummary(cats, now, month);
      const view = monthSummary.categories.find((v) => v.categoryId === top.id);
      if (!view) return;
      const accountName = accounts.find((a) => a.id === tx.accountId)?.name ?? 'Account';
      setSaved({
        title: draft.payeeName ?? draft.note ?? cat.name,
        amountText: `−${formatMoney(tx.amount, tx.currency)}`,
        meta: `${cat.icon ?? '🏷️'} ${cat.name} · ${accountName} · ${dateLabelFor(tx.occurredAt, now)}`,
        chip: savedChip({ icon: top.icon ?? '🏷️', name: top.name, view, txMonth: month, now, currency }),
      });
    } catch {
      // The chip is garnish.
    }
  };

  return {
    reply,
    edit,
    saved,
    presetCategoryRef,
    clear,
    clearSaved: () => setSaved(null),
    dropStaleReply,
    answerIntent,
    onSuggestionYes,
    onConfirmSetBudget,
    onConfirmRemoveBudget,
    onConfirmCreateCategory,
    onSuggestionCreate,
    onDismiss: idle,
    onPick,
    onLog,
    onRaise,
    onEditSave,
    closeEdit: () => setEdit(null),
    showSavedChip,
  };
}
