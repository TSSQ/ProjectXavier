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
import { toMinorUnits, formatMoney } from '../../domain/money';
import { dateLabelFor } from '../../domain/dates';
import {
  BudgetIntent,
  AffordIntent,
  affordLogText,
  resolveBudgetCategory,
} from '../../domain/budgetIntent';
import { AffordPlan, PickOption, planAfford } from '../../domain/affordPlan';
import {
  BudgetSummary,
  BudgetScope,
  MonthKey,
  budgetFor,
  computeBudgets,
  monthKeyOf,
  topLevelCategoryId,
} from '../../domain/budgets';
import {
  SavedChip,
  savedChip,
  setBudgetConfirmText,
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
  | { kind: 'set-budget-suggest'; category: Category; next: number; currency: string }
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

  const openConfirm = (
    category: Category,
    next: number,
    rows: Awaited<ReturnType<typeof listBudgetRows>>,
    now: number,
    rev: number
  ) => {
    const month = monthKeyOf(now);
    const current = budgetFor(rows, category.id, month);
    setReply(setBudgetConfirmText({ categoryName: category.name, current, next, month, currency }));
    setCard({ kind: 'set-budget', category, current, next, month, currency, dataRevision: rev });
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
      const target = resolveBudgetCategory(intent.categoryName, cats);
      if (target.kind === 'none') {
        setReply(`I couldn't find a ${titleCase(intent.categoryName)} category.`);
        setCard({ kind: 'budget-unknown', dataRevision });
        setLastOutcome('clarify');
        return;
      }
      const next = toMinorUnits(intent.amount, currency);
      if (target.kind === 'suggestion') {
        setReply(`Did you mean ${target.category.name}?`);
        setCard({ kind: 'set-budget-suggest', category: target.category, next, currency, dataRevision });
        return;
      }
      openConfirm(target.category, next, rows, now, dataRevision);
    } catch {
      fail("I couldn't work that out — please try again.");
    }
  };

  const onSuggestionYes = async () => {
    if (reply?.kind !== 'set-budget-suggest' || busy) return;
    try {
      const { category, next } = reply;
      const { rows, dataRevision } = await loadSummary(categories, Date.now());
      openConfirm(category, next, rows, Date.now(), dataRevision);
    } catch {
      fail("I couldn't work that out — please try again.");
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
    onDismiss: idle,
    onPick,
    onLog,
    onRaise,
    onEditSave,
    closeEdit: () => setEdit(null),
    showSavedChip,
  };
}
