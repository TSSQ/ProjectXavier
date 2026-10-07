/**
 * The Assistant's budget answers (docs/design/monthly-budgets-spec.md §6),
 * extracted from app/(tabs)/index.tsx: the afford card and its "which budget?"
 * chips, the set-budget confirm, "Raise <category> budget", and the
 * receipt a saved transaction gains in the speech bubble. One card at a time, like the other answer states. The
 * sentence goes through `setReply`; every figure comes from the budget domain.
 *
 * Every card remembers the data revision it was built against, and the screen
 * drops it (`dropStaleReply`) when the ledger has moved on underneath it.
 */
import { useCallback, useRef, useState } from 'react';
import type { ChatCardKind } from '../../domain/chatMessage';
import { LOG_KINDS_OF } from '../../domain/liveCard';
import { Account, Category, Payee, RecurrenceRule, Transaction, TransactionType } from '../../domain/types';
import { AssistantOutcomeKind } from '../../domain/avatar';
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
  budgetClarifyText,
  createCategoryOfferText,
  noCategoryText,
  titleCase,
} from '../../domain/budgetCopy';
import {
  BubbleContent,
  SAVED_FALLBACK,
  budgetRemovedReceipt,
  budgetSetReceipt,
  createCategoryReceipt,
  savedReceipt,
  seriesText,
  textBubble,
} from '../../domain/bubbleCopy';
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
import type { ChatRecorder } from '../../domain/chatRecorder';
import { budgetCard } from '../../domain/chatRecord';

import { CreateCategoryRefused, createCategoryWithBudget } from './createCategoryBudget';

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

export interface BudgetEditState {
  target: BudgetEditTarget;
  month: MonthKey;
}

export interface BudgetRepliesDeps {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setReply: (text: string, options?: { record?: boolean; logged?: boolean }) => void;
  /** The chat log (record only): cards shown, resolved or dismissed here. */
  chat: ChatRecorder;
  /** Shows a structured receipt in the speech bubble. */
  setReceipt: (content: BubbleContent, meta?: { logged?: boolean }) => void;
  setLastOutcome: (outcome: AssistantOutcomeKind) => void;
  currency: string;
  categories: Category[];
  payees: Payee[];
  accounts: Account[];
  /** The screen's parse entry point ("Log it" runs it, forced as an expense). */
  runParse: (text: string, options?: { forceExpense?: boolean }) => Promise<void>;
}

const SAVE_FAILED = "I couldn't save that budget — please try again.";

/** The chat-log card kinds a budget reply is stored as. */
const BUDGET_CARD_KINDS: readonly ChatCardKind[] = LOG_KINDS_OF.budget;

export function useBudgetReplies(deps: BudgetRepliesDeps) {
  const { busy, setBusy, setReply, setReceipt, setLastOutcome, currency, categories, payees, accounts, chat } =
    deps;
  const [reply, setReplyState] = useState<BudgetReply | null>(null);
  const [edit, setEdit] = useState<BudgetEditState | null>(null);
  // Mirror for the focus-time staleness check (a callback keyed on nothing
  // cannot read the state it closed over).
  const replyRef = useRef<BudgetReply | null>(null);
  const setCard = useCallback((next: BudgetReply | null) => {
    replyRef.current = next;
    setReplyState(next);
  }, []);
  /** The sentence Xavier is saying right now, captured when a card is created. */
  const saidRef = useRef('');
  const speak = (text: string) => {
    saidRef.current = text;
    setReply(text);
  };
  /** Shows a budget card: the screen's reply plus its chat-log card. */
  const present = (next: BudgetReply) => {
    setCard(next);
    const body = budgetCard(next, { currency, text: saidRef.current });
    shownIdRef.current = body ? chat.showCard(body, next.dataRevision) : null;
  };
  /** The id `present` got back for the budget card on screen. */
  const shownIdRef = useRef<string | null>(null);
  const takeShownId = (): string | null => {
    const id = shownIdRef.current;
    shownIdRef.current = null;
    return id;
  };
  // Kind-scoped: these only ever act on a budget card, never on whichever card
  // is newest (a draft or an account card may have replaced ours during an await).
  const resolveCard = () => {
    const id = takeShownId();
    if (id) chat.resolve(id, { kinds: BUDGET_CARD_KINDS });
  };
  const expireCard = () => {
    const id = takeShownId();
    if (id) chat.expire(id, BUDGET_CARD_KINDS);
  };
  /** The screen cleared the card after a failure, with nothing said about it. */
  const abandonCard = () => {
    const id = takeShownId();
    if (id) chat.dismiss(id, undefined, BUDGET_CARD_KINDS);
  };
  /** The category an afford "Log it" presets on the draft it opens; consumed
   *  by the next parse. */
  const presetCategoryRef = useRef<{ id: string; name: string } | null>(null);

  const idle = () => {
    setCard(null);
  };

  /** "Not now" on a budget card: the log stubs it (the screen shows no line for
   *  it, so none is recorded). */
  const onDismiss = () => {
    abandonCard();
    idle();
  };

  /** A new message replaces whatever budget card was showing. */
  const clear = () => {
    setCard(null);
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
    speak(plan.text);
    if (plan.kind === 'answer') present({ kind: 'afford', intent, plan, summary, dataRevision: rev });
    else if (plan.kind === 'pick') present({ kind: 'afford-pick', intent, options: plan.options, dataRevision: rev });
    else present({ kind: 'no-budgets', dataRevision: rev });
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
    speak(plan.text);
    if (plan.kind === 'confirm-set') {
      present({ kind: 'set-budget', category, current: plan.current, next: plan.next, month, currency, dataRevision: rev });
    } else if (plan.kind === 'confirm-remove') {
      present({ kind: 'remove-budget', category, current: plan.current, month, currency, write: plan.write, dataRevision: rev });
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
        speak(found.text);
        // A set-budget with a name that cannot be a category keeps "Open Budget".
        if (intent.kind === 'set-budget') present({ kind: 'budget-unknown', dataRevision });
        else setCard(null);
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
        speak(`Did you mean ${found.category.name}?`);
        present({
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
    speak(createCategoryOfferText({ name, amount: action.amount, currency }));
    present({ kind: 'create-category', name, next: action.amount, month: monthKeyOf(now), currency, dataRevision: rev });
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
      if (noOffer) setCard(null);
      else present({ kind: 'budget-unknown', dataRevision });
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
      resolveCard();
      openPlan(category, action, rows, Date.now(), dataRevision);
    } catch {
      fail("I couldn't work that out — please try again.");
    }
  };

  /** [Create "Dinning"] on a "did you mean" card: on to the create offer. */
  const onSuggestionCreate = () => {
    if (reply?.kind !== 'set-budget-suggest' || busy || !reply.createName) return;
    resolveCard();
    offerCreate(reply.createName, reply.action, Date.now(), reply.dataRevision);
  };

  const onConfirmCreateCategory = async () => {
    if (reply?.kind !== 'create-category' || busy) return;
    const { name, next, month, currency: builtIn } = reply;
    setBusy(true);
    try {
      if (builtIn !== (await getCurrency())) {
        expireCard();
        setCard(null);
        fail(setBudgetRefusalText('currency-changed'));
        return;
      }
      await createCategoryWithBudget({ name, amount: next, month });
      resolveCard();
      setCard(null);
      setReceipt(createCategoryReceipt({ name, amount: next, month, currency }));
      setLastOutcome('saved');
    } catch (e) {
      // The screen clears this card on failure, so the log stops showing it live.
      abandonCard();
      setCard(null);
      fail(e instanceof CreateCategoryRefused ? e.message : SAVE_FAILED);
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
        expireCard();
        setCard(null);
        fail(setBudgetRefusalText(check));
        return;
      }
      await setBudget({ categoryId: category.id, amount: next, month, scope: 'onward' });
      resolveCard();
      setCard(null);
      setReceipt(
        budgetSetReceipt({
          categoryName: category.name,
          next,
          previous: reply.current,
          month,
          currency,
        })
      );
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
        expireCard();
        setCard(null);
        fail(setBudgetRefusalText(check));
        return;
      }
      await setBudget({ categoryId: category.id, amount: write.amount, month, scope: write.scope });
      resolveCard();
      setCard(null);
      setReceipt(budgetRemovedReceipt({ categoryName: category.name, month, scope: write.scope }));
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
      resolveCard();
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
    resolveCard();
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
        expireCard();
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
      resolveCard();
      setCard(null);
      if (amount === null) setReceipt(budgetRemovedReceipt({ categoryName: name, month, scope }));
      else {
        setReceipt(
          budgetSetReceipt({
            categoryName: name,
            next: amount,
            previous: edit.target.current,
            month,
            currency,
            scope,
          })
        );
      }
      setLastOutcome('saved');
    } catch {
      fail(SAVE_FAILED);
    }
  };

  /** The budget part of a receipt: the top-level category's view for the
   *  transaction's month, or null when that category has no budget. */
  const budgetForSaved = async (
    categoryId: string,
    byId: Map<string, Category>,
    occurredAt: number,
    now: number,
    cats: Category[]
  ) => {
    const top = byId.get(topLevelCategoryId(categoryId, byId) ?? '');
    if (!top) return null;
    const month = monthKeyOf(occurredAt);
    const { summary } = await loadSummary(cats, now, month);
    const view = summary.categories.find((v) => v.categoryId === top.id);
    return view ? { topName: top.name, view, month, currency } : null;
  };

  /**
   * After a save, puts the receipt in the speech bubble (spec §4): what was
   * saved and, for an expense whose top-level category has a budget that
   * month, what is left. The category comes from the SAVED transaction
   * (`txId`), not from re-matching a name. A save with no `txId` became a
   * repeating series. If the transaction can no longer be read the bubble
   * falls back to "Saved." and never shows stale numbers.
   */
  const showSavedReceipt = async (
    draft: {
      type: TransactionType;
      amount: number;
      currency: string;
      payeeName: string | null;
      note: string | null;
      categoryName: string | null;
    },
    txId: string | null,
    repeatRule?: RecurrenceRule | null,
    /** False once something newer has spoken; a late receipt must not overwrite it. */
    stillCurrent: () => boolean = () => true
  ) => {
    // Every chat save is counted (`logged`): the screen shows the line only while
    // nothing newer has spoken, but the chat log records it either way.
    const confirm = (content: BubbleContent) => {
      if (stillCurrent()) {
        if (content.kind === 'text') setReply(content.text, { logged: true });
        else setReceipt(content, { logged: true });
      } else {
        chat.recordXavier(content, { logged: true });
      }
    };
    if (!txId) {
      // A repeating series: shown unconditionally, as before.
      setReply(
        seriesText({
          title: draft.payeeName ?? draft.note ?? draft.categoryName,
          amount: draft.amount,
          currency: draft.currency,
          rule: repeatRule,
        }),
        { logged: true }
      );
      return;
    }
    try {
      const tx: Transaction | null = await getTransaction(txId);
      if (!tx) {
        confirm(textBubble(SAVED_FALLBACK));
        return;
      }
      const now = Date.now();
      const cats = await listCategories();
      const byId = new Map(cats.map((x) => [x.id, x]));
      const cat = tx.categoryId ? byId.get(tx.categoryId) : undefined;
      const budget =
        tx.type === 'expense' && cat ? await budgetForSaved(cat.id, byId, tx.occurredAt, now, cats) : null;
      const nameOf = (id: string | null | undefined) =>
        accounts.find((a) => a.id === id)?.name ?? 'Account';
      confirm(
        savedReceipt({
          type: tx.type,
          amount: tx.amount,
          currency: tx.currency,
          occurredAt: tx.occurredAt,
          now,
          payeeName: draft.payeeName,
          note: draft.note,
          category: cat ? { name: cat.name, icon: cat.icon } : null,
          accountName: nameOf(tx.accountId),
          toAccountName: tx.transferAccountId ? nameOf(tx.transferAccountId) : null,
          budget,
        })
      );
    } catch {
      // The receipt is garnish: the save itself already succeeded.
      confirm(textBubble(SAVED_FALLBACK));
    }
  };

  return {
    reply,
    edit,
    presetCategoryRef,
    clear,
    dropStaleReply,
    answerIntent,
    onSuggestionYes,
    onConfirmSetBudget,
    onConfirmRemoveBudget,
    onConfirmCreateCategory,
    onSuggestionCreate,
    onDismiss,
    onPick,
    onLog,
    onRaise,
    onEditSave,
    closeEdit: () => setEdit(null),
    showSavedReceipt,
  };
}
