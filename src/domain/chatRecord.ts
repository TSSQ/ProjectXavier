/**
 * Maps what the Assistant screen is showing to chat-log message bodies
 * (docs/design/xavier-daily-chat-spec.md §5): pure, and the only place the
 * screen's state shapes meet the stored payload schemas. Every mapper returns
 * `null` rather than guess when the state cannot fill a required field, so a
 * card that cannot be recorded faithfully is skipped, never invented.
 *
 * Only deterministic data is mapped (names, minor-unit amounts, enums, a tool's
 * own result and caption). The stored payloads are validated again by zod when
 * the repository writes them (src/domain/chatMessage.ts).
 */
import type { Account, Category, Payee, Transaction } from './types';
import type { TransactionDraft } from './assistant';
import type { ReadyAccount } from './accountAssistant';
import type { AccountUpdateDraft } from './accountUpdateAssistant';
import type { AffordIntent } from './budgetIntent';
import type { AffordPlan, PickOption } from './affordPlan';
import { AFFORD_PICK_TEXT } from './affordPlan';
import type { BudgetChatAction } from './budgetChatPlan';
import type { DraftQueue } from './draftQueue';
import { queueSummary } from './draftQueue';
import type { QueryComparison } from './queryComparison';
import type { QueryToolName } from './queryTools';
import type { BubbleContent } from './bubbleCopy';
import { savedReceipt } from './bubbleCopy';
import { toMinorUnits } from './money';
import type { CardBody } from './chatLog';
import type { ChatBody } from './chatLog';

type XavierBody = Extract<ChatBody, { kind: 'xavier_text' | 'xavier_receipt' }>;

/** A text bubble or receipt. `logged` marks the line that confirms a transaction saved here. */
export function bubbleBody(content: BubbleContent, options?: { logged?: boolean }): XavierBody {
  if (content.kind === 'text') {
    return { kind: 'xavier_text', payload: { text: content.text, ...(options?.logged && { logged: true }) } };
  }
  const { headline, amountText, amountTone, lines, budget } = content;
  return {
    kind: 'xavier_receipt',
    payload: {
      headline,
      lines,
      ...(amountText !== undefined && { amountText }),
      ...(amountTone !== undefined && { amountTone }),
      ...(budget !== undefined && { budget }),
      ...(options?.logged && { logged: true }),
    },
  };
}

/** A photo message: a label, never the image. */
export const photoBody = (label: string): Extract<ChatBody, { kind: 'user_photo' }> => ({
  kind: 'user_photo',
  payload: { label },
});

// ─── cards ──────────────────────────────────────────────────────────────────

export function draftCard(draft: TransactionDraft, accounts: Account[]): CardBody | null {
  const account = accounts.find((a) => a.id === draft.accountId);
  if (!account) return null;
  return {
    kind: 'draft',
    payload: {
      type: draft.type,
      amount: draft.amount,
      currency: draft.currency,
      accountName: account.name,
      toAccountName: draft.transferAccountName ?? null,
      categoryName: draft.categoryName,
      payeeName: draft.payeeName,
      note: draft.note,
      occurredAt: draft.occurredAt,
      ...(draft.unmatchedAccountName !== undefined && { unmatchedAccountName: draft.unmatchedAccountName }),
      ...(draft.ambiguousAccountNames !== undefined && { ambiguousAccountNames: draft.ambiguousAccountNames }),
    },
  };
}

export function accountCreateCard(ready: ReadyAccount, currency: string): CardBody {
  return {
    kind: 'account_create',
    payload: {
      name: ready.name,
      subtype: ready.subtype ?? null,
      openingBalance: ready.openingBalance,
      currency,
    },
  };
}

export function accountUpdateCard(
  draft: AccountUpdateDraft & { accountId: string; currentName: string },
  currency: string
): CardBody {
  return {
    kind: 'account_update',
    payload: {
      accountId: draft.accountId,
      currentName: draft.currentName,
      op: draft.op,
      newName: draft.newName,
      newSubtype: draft.newSubtype ?? null,
      newBalance: draft.newBalance,
      balanceEdited: draft.balanceEdited,
      currency,
    },
  };
}

export function deleteHandoffCard(
  handoff: { accountId: string; accountName: string },
  message: string
): CardBody {
  return { kind: 'delete_handoff', payload: { ...handoff, message } };
}

export function txPickerCard(
  txOp: { op: 'delete' | 'update'; candidates: Transaction[] },
  lists: { accounts: Account[]; categories: Category[]; payees: Payee[] },
  currency: string
): CardBody {
  const name = <T extends { id: string; name: string }>(list: T[], id: string | null | undefined) =>
    list.find((x) => x.id === id)?.name ?? null;
  return {
    kind: 'tx_picker',
    payload: {
      op: txOp.op,
      currency,
      rows: txOp.candidates.slice(0, 50).map((tx) => ({
        id: tx.id,
        type: tx.type,
        amountMinor: tx.amount,
        occurredAt: tx.occurredAt,
        payeeName: name(lists.payees, tx.payeeId),
        categoryName: name(lists.categories, tx.categoryId),
        accountName: name(lists.accounts, tx.accountId),
      })),
    },
  };
}

/** The tool's own result and deterministic caption; `result` is validated on write. */
export function queryAnswerCard(
  answer: { tool: QueryToolName; result: unknown; caption: string | null; comparison: QueryComparison | null },
  currency: string
): CardBody {
  return {
    kind: 'query_answer',
    payload: {
      tool: answer.tool,
      result: answer.result,
      caption: answer.caption,
      comparison: answer.comparison,
      currency,
    },
  } as CardBody;
}

export function statementQueueCard(queue: DraftQueue, accounts: Account[]): CardBody {
  const { saved, skipped } = queueSummary(queue);
  const first = queue.drafts[0];
  return {
    kind: 'statement_queue',
    payload: {
      total: queue.drafts.length,
      saved,
      skipped,
      accountName: accounts.find((a) => a.id === first?.accountId)?.name ?? null,
    },
  };
}

/** The receipt a confirmed statement row appends (recorded with `logged: true`). */
export function queueRowReceipt(draft: TransactionDraft, accounts: Account[], now: number): BubbleContent {
  const nameOf = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name ?? 'Account';
  return savedReceipt({
    type: draft.type,
    amount: draft.amount,
    currency: draft.currency,
    occurredAt: draft.occurredAt,
    now,
    payeeName: draft.payeeName,
    note: draft.note,
    category: draft.categoryName ? { name: draft.categoryName } : null,
    accountName: nameOf(draft.accountId),
    toAccountName: draft.transferAccountName ?? null,
  });
}

// ─── budget cards ───────────────────────────────────────────────────────────

/** The parts of the budget replies the log records (`BudgetReply` fits this). */
export type BudgetCardInput =
  | { kind: 'afford'; plan: Extract<AffordPlan, { kind: 'answer' }> }
  | { kind: 'afford-pick'; intent: AffordIntent; options: PickOption[] }
  | { kind: 'set-budget'; category: { name: string }; current: number | null; next: number; currency: string }
  | { kind: 'set-budget-suggest'; category: { name: string }; action: BudgetChatAction; currency: string }
  | { kind: 'create-category'; name: string; next: number; currency: string }
  | { kind: 'remove-budget'; category: { name: string }; current: number; currency: string }
  | { kind: 'no-budgets' | 'budget-unknown' };

/**
 * `text` is the question Xavier asked with the card (the reply set alongside
 * it): the card state does not hold it, so the caller passes the latest Xavier
 * line. `currency` is the app currency for replies that do not carry their own.
 */
export function budgetCard(
  reply: BudgetCardInput,
  ctx: { currency: string; text: string }
): CardBody | null {
  switch (reply.kind) {
    case 'afford': {
      const { plan } = reply;
      return {
        kind: 'afford',
        payload: {
          text: plan.text,
          scope: plan.scope,
          categoryName: plan.categoryName,
          icon: plan.icon,
          amount: plan.amount,
          month: plan.month,
          currency: ctx.currency,
          verdict: plan.result.verdict,
          leftNow: plan.result.leftNow,
          after: plan.result.after,
          overall: plan.overall,
          view: plan.view
            ? { budget: plan.view.budget, spent: plan.view.spent, left: plan.view.left, state: plan.view.state }
            : null,
        },
      };
    }
    case 'afford-pick':
      return {
        kind: 'afford_pick',
        payload: {
          text: AFFORD_PICK_TEXT,
          amount: toMinorUnits(reply.intent.amount, ctx.currency),
          currency: ctx.currency,
          options: reply.options.map((o) => ({ categoryId: o.categoryId, name: o.name, icon: o.icon })),
        },
      };
    case 'set-budget':
      return setBudget(reply.category.name, reply.current === null ? 'set' : 'edit', ctx.text, reply.current, reply.next, reply.currency);
    case 'remove-budget':
      return setBudget(reply.category.name, 'remove', ctx.text, reply.current, null, reply.currency);
    case 'create-category':
      return setBudget(reply.name, 'set', ctx.text, null, reply.next, reply.currency);
    case 'set-budget-suggest': {
      const { action } = reply;
      const change = action.kind === 'set' ? 'set' : action.kind === 'remove' ? 'remove' : 'edit';
      const next = action.kind === 'set' || action.kind === 'edit-to' ? action.amount : null;
      // `current` is not on the card state, so it is left unknown (null).
      return setBudget(reply.category.name, change, ctx.text, null, next, reply.currency);
    }
    default:
      // "Open Budget" and "no budgets yet" have no stored card kind; the
      // sentence that goes with them is recorded as Xavier's text instead.
      return null;
  }
}

function setBudget(
  categoryName: string,
  change: 'set' | 'edit' | 'remove',
  text: string,
  current: number | null,
  next: number | null,
  currency: string
): CardBody {
  return { kind: 'set_budget', payload: { categoryName, change, text, current, next, currency } };
}
