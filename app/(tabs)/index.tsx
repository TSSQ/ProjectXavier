import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, Alert, Platform, Keyboard, useWindowDimensions } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { useGlass } from '../../src/theme/useGlass';
import { useScaledType } from '../../src/theme/useScaledType';
import { saveAssistantDraft } from '../../src/features/ai/saveDraft';
import { listAccounts, createAccount, updateAccount } from '../../src/features/accounts/repository';
import {
  listCategories,
  findOrCreateByName as findOrCreateCategory,
} from '../../src/features/categories/repository';
import {
  listPayees,
  findOrCreateByName as findOrCreatePayee,
  getPayeeByName,
} from '../../src/features/payees/repository';
import {
  listTransactions,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  deleteTransactions,
} from '../../src/features/transactions/repository';
import { listSeries } from '../../src/features/recurring/repository';
import {
  getCurrency,
  getOnboardingComplete,
  getByokEnabled,
  getByokProvider,
  getByokModel,
  getDataRevision,
} from '../../src/features/settings/repository';
import {
  interpret,
  TransactionDraft,
  acceptAccountSuggestion,
  dismissAccountSuggestion,
} from '../../src/domain/assistant';
import {
  checkDraftIntegrity,
  DraftAccountGoneError,
  DraftTransferAccountGoneError,
  DraftCurrencyStaleError,
  DraftIntegrityStatus,
} from '../../src/domain/draftIntegrity';
import { isAccountCommand, transactionCommandBody, startAccountFlow, advanceAccountFlow, buildReadyAccountFromChat, normalizeSubtype, parseOpeningBalance, AccountFlowState, ReadyAccount } from '../../src/domain/accountAssistant';
import { detectAccountIntent, extractAccountReferenceFragment } from '../../src/domain/accountIntent';
import { detectQueryIntent } from '../../src/domain/queryIntent';
import { detectTransactionOpCandidate } from '../../src/domain/transactionOpIntent';
import { buildCandidateFilter, selectCandidates, fingerprintTransaction, fingerprintsMatch, summarizeTransactionSelection, TransactionCandidateFilter, CandidateFilterContext, DroppedConstraint, TransactionSelectionSummary } from '../../src/domain/transactionCandidates';
import {
  executeQueryTool,
  applyDeterministicPeriodOverride,
  QueryToolContext,
  QueryToolCall,
  QueryToolName,
} from '../../src/domain/queryTools';
import { resolveFloorQueryCall } from '../../src/domain/queryFloor';
import { buildDeterministicQueryCaption } from '../../src/domain/queryCaption';
import { buildQueryComparison, QueryComparison } from '../../src/domain/queryComparison';
import { AccountExtraction } from '../../src/domain/accountParsePrompt';
import { AccountUpdateDraftExtraction } from '../../src/domain/accountUpdatePrompt';
import {
  buildAccountUpdateDraft,
  buildAccountUpdateClarifyMessage,
  resolveUpdatedAccount,
  AccountUpdateDraft,
} from '../../src/domain/accountUpdateAssistant';
import { findAccountMatch, AccountMatch } from '../../src/domain/accountMatch';
import { computeAccountDeleteImpact } from '../../src/domain/accountDeleteImpact';
import { buildAccountDeleteHandoff } from '../../src/domain/accountDeleteHandoff';
import {
  matchCommands,
  plusMenuRows,
  AssistantCommand,
  PlusMenuRow,
} from '../../src/domain/assistantCommands';
import {
  composerState,
  draftShape,
  sameDraftShape,
  DraftShape,
  EMPTY_DRAFT_SHAPE,
} from '../../src/domain/composerState';
import { DraftComposer, DraftComposerHandle } from '../../src/components/ui/Composer';
import { useStableCallback } from '../../src/lib/useStableCallback';
import { AssistantExamplesSheet } from '../../src/components/ui/AssistantExamplesSheet';
import { ContextMenu, ContextMenuItem } from '../../src/components/ui/ContextMenu';
import { BudgetIntent, detectBudgetIntent } from '../../src/domain/budgetIntent';
import { budgetFallback } from '../../src/domain/budgetFm';
import { presetCategoryName } from '../../src/domain/affordPlan';
import { useBudgetReplies } from '../../src/features/budgets/useBudgetReplies';
import { useChatLog } from '../../src/features/chat/useChatLog';
import { ChatFeed, ChatFeedHandle, LiveSlotContext } from '../../src/components/assistant/ChatFeed';
import { HeroHeaderStage, useLayoutPhase } from '../../src/components/assistant/HeroHeader';
import { announceIncoming } from '../../src/components/assistant/announce';
import type { ChatCardKind } from '../../src/domain/chatMessage';
import {
  CHAT_RESET_NOTE_TEXT,
  arrivalsSince,
  buildFeedRows,
  isQuietDay,
  computeTail,
  pillStillNeeded,
  scrollDecision,
  shouldClearNoteOnPhase,
  showResetNote,
} from '../../src/domain/chatFeed';
import { LIVE_KINDS, LOG_KINDS_OF, ScreenCards, liveCardOf, liveCardProblem } from '../../src/domain/liveCard';
import { loggedTodayCount, newestLiveCard } from '../../src/domain/chatLog';
import { monthKeyOf } from '../../src/domain/budgets';
import { budgetCard } from '../../src/domain/chatRecord';
import { BudgetEditSheet } from '../../src/components/budgets/BudgetEditSheet';
import { PHOTO_LABELS } from '../../src/domain/chatCopy';
import type { CardBody } from '../../src/domain/chatLog';
import {
  accountCreateCard,
  accountUpdateCard,
  deleteHandoffCard,
  draftCard,
  queryAnswerCard,
  queueRowReceipt,
  statementQueueCard,
  txPickerCard,
} from '../../src/domain/chatRecord';
import { SpeechBubble } from '../../src/components/assistant/SpeechBubble';
import {
  ACCOUNT_UPDATE_CANCELLED_TEXT,
  BubbleContent,
  DISCARDED_TEXT,
  SAVED_FALLBACK,
  accountArchivedText,
  accountCreatedReceipt,
  accountUpdatedText,
  textBubble,
  deletedManyText,
  deletedText,
  shouldApplyReceipt,
  updatedReceiptFor,
} from '../../src/domain/bubbleCopy';
import { AccountPickerSheet } from '../../src/components/ui/AccountPickerSheet';
import { FM_REFUSAL_REPLY, FmFallbackReason } from '../../src/domain/fmRefusal';
import { heuristicExpense } from '../../src/domain/heuristicParse';
import {
  isDeviceAiAvailable,
  deviceParse,
  deviceParseAccount,
  deviceParseAccountUpdate,
  deviceParseQuerySelection,
  deviceParseTransactionOp,
  deviceParseBudget,
} from '../../src/features/ai/deviceParse';
import { runQueryLoop } from '../../src/features/ai/queryLoop';
import { isUsefulDeviceParse } from '../../src/domain/deviceParsePrompt';
import { AiParsedExpense } from '../../src/lib/validation';
import {
  routeEngines,
  resolveByokEnabled,
  EngineId,
  ByokProvider,
} from '../../src/domain/parseRouter';
import { openaiParse } from '../../src/features/ai/engines/openai';
import { anthropicParse } from '../../src/features/ai/engines/anthropic';
import {
  ACCOUNT_PARSE_CONTRACT,
  ACCOUNT_UPDATE_PARSE_CONTRACT,
  EXPENSE_PARSE_CONTRACT,
  TRANSACTION_OP_PARSE_CONTRACT,
} from '../../src/features/ai/engines/shared';
import { getByokKey, hasByokKey } from '../../src/features/ai/byokKey';
import { isOnline } from '../../src/features/ai/network';
import { findPayeeMatch, resolveCategoryId } from '../../src/domain/payees';
import {
  applyLearnedDefaults,
  clearLearnedCategoryFlag,
  revertLearnedAccount,
  revertLearnedCategory,
} from '../../src/domain/learnedDefaults';
import { findCategoryMatch } from '../../src/domain/categories';
import { METRICS_ENABLED } from '../../src/lib/flags';
import { recordCorrection } from '../../src/features/diagnostics/corrections';
import { confidenceBucket, inputLenBucket, fmFallbackDetail, notTransactionCueDetail } from '../../src/domain/parseMetrics';
import {
  recordParse,
  resolveParse,
  ParseOutcome,
} from '../../src/features/diagnostics/parseMetrics';
import { getRecognizer } from '../../src/features/ocr/appleVisionRecognizer';
import { classifyOcrText } from '../../src/domain/ocrResult';
import { reconstructLayout, StatementLayout } from '../../src/domain/statementLayout';
import {
  rowsToDrafts,
  applyLayoutAmount,
  forgetUnmatchedAccount,
  findStatementPayeeMatch,
  MAX_STATEMENT_ROWS,
  chooseScanRoute,
} from '../../src/domain/statementDrafts';
import {
  DraftQueue,
  startQueue,
  currentDraft,
  decideCurrent,
  queueDone,
  statementSummary,
  reviewProgress,
  stopReviewing,
} from '../../src/domain/draftQueue';
import { formatMoney } from '../../src/domain/money';
import { backfillOccurrences } from '../../src/domain/recurrence';
import { Account, Category, Payee, Transaction } from '../../src/domain/types';
import {
  TransactionFormSheet,
  FormValues,
} from '../../src/components/transactions/TransactionFormSheet';
import { avatarStateFor, AssistantOutcomeKind } from '../../src/domain/avatar';
import { replySettleRule } from '../../src/domain/replySettle';
import { DepthField } from '../../src/components/ui/DepthField';
import { ParseSource } from '../../src/components/assistant/DraftCard';
import { TxOpShowAllSheet, TxOpState } from '../../src/components/assistant/TransactionOpPicker';
import { SlashMenu } from '../../src/components/assistant/SlashMenu';
import {
  DeleteHandoffState,
  LiveCardSlot,
  FeedTail,
  LiveHandlers,
  PendingAccountUpdate,
  QueryAnswerState,
  ScreenValues,
  TxPickerLive,
} from '../../src/components/assistant/LiveCardSlot';

const GREETING =
  "Hi, I'm Xavier. Tell me about an expense, snap a receipt or a statement, or tap + for more.";

// Derived from the one map of flow -> stored kinds (`LOG_KINDS_OF`).
const DRAFT_KINDS = LOG_KINDS_OF.draft;
const ACCOUNT_CREATE_KINDS = LOG_KINDS_OF.account_create;
const ACCOUNT_UPDATE_KINDS = LOG_KINDS_OF.account_update;
const DELETE_HANDOFF_KINDS = LOG_KINDS_OF.delete_handoff;
const QUERY_KINDS = LOG_KINDS_OF.query_answer;
const TX_PICKER_KINDS = LOG_KINDS_OF.tx_picker;
const STATEMENT_QUEUE_KINDS: readonly ChatCardKind[] = ['statement_queue'];

/** Names an AI engine for the card's fallback line ("On-device AI didn't
 *  answer…"). */
const AI_ENGINE_NAME: Record<Exclude<EngineId, 'heuristic'>, string> = {
  foundation: 'On-device AI',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/** Maps a router EngineId (src/domain/parseRouter.ts) to the diagnostics
 *  metric label an engine's own success path already uses ('foundation' ->
 *  'on_device', matching runFmParse's recordParse call) — reused by
 *  runParse's outer catch so an unexpected throw is labeled with whichever
 *  engine the router-driven loop was actually attempting, not a guess. */
const ENGINE_METRIC_LABEL: Record<EngineId, 'openai' | 'anthropic' | 'on_device' | 'heuristic'> = {
  openai: 'openai',
  anthropic: 'anthropic',
  foundation: 'on_device',
  heuristic: 'heuristic',
};

/** Same router-EngineId mapping as `ENGINE_METRIC_LABEL`, but for the
 *  chat-driven account-creation gate specifically (spec §5.5): its
 *  `'heuristic'` position in the router order is NOT a real heuristic parse
 *  (there's no `localParse`-equivalent for accounts) — it's "no extraction
 *  engine ran at all, the confirm card is fully defaulted from the gate's own
 *  subtypeHint" (docs/design/account-chat-creation-spec.md §5.4 point 1).
 *  Recording that as `'heuristic'` would conflate it with the expense
 *  tier's genuine deterministic parse, so it gets its own `'floor'` label —
 *  reusing `ENGINE_METRIC_LABEL`'s object would require two different labels
 *  for the same key, which isn't possible in one shared map. */
const ACCOUNT_ENGINE_METRIC_LABEL: Record<EngineId, 'openai' | 'anthropic' | 'on_device' | 'floor'> = {
  openai: 'openai',
  anthropic: 'anthropic',
  foundation: 'on_device',
  heuristic: 'floor',
};

/** "Which account?" prompt for an update/delete gate hit that
 *  `findAccountMatch` couldn't confidently resolve — asks rather than
 *  guesses (docs/design/account-chat-crud-spec.md §5.1). */
function accountDisambiguationPrompt(match: AccountMatch | null): string {
  if (match?.ambiguous?.length) {
    const names = match.ambiguous.map((a) => a.name).join(' or ');
    return `Which account did you mean — ${names}?`;
  }
  if (match?.suggestion) {
    return `I couldn't find that account — did you mean "${match.suggestion.name}"?`;
  }
  return "I couldn't find that account. Which one did you mean?";
}

const DROPPED_CONSTRAINT_LABEL: Record<DroppedConstraint, string> = {
  amount: 'the amount',
  payee: 'the payee',
  account: 'the account',
  date: 'the date',
};

/** "I couldn't match the amount exactly, so here's a wider list" (spec
 *  §5.3) — every constraint the cascade had to drop is reported. `null`
 *  when nothing was dropped (every stated constraint matched as-is). */
function describeDroppedConstraints(dropped: DroppedConstraint[]): string | null {
  if (!dropped.length) return null;
  const named = dropped.map((d) => DROPPED_CONSTRAINT_LABEL[d]).join(' or ');
  return `I couldn't match ${named} exactly, so here's a wider list.`;
}

/** The chat reply for a tx_op picker render (spec §5.4/§9.4) — always names
 *  what was searched, never a silent no-op. `op === 'delete'` with more than
 *  one candidate phrases the picker as a SELECTION (multi-select delete,
 *  spec §13 amendment), not "which one" — update stays single-pick and
 *  keeps that wording unchanged. */
function txOpReplyMessage(
  op: 'delete' | 'update',
  candidates: Transaction[],
  dropped: DroppedConstraint[]
): string {
  const verb = op === 'delete' ? 'delete' : 'update';
  if (candidates.length === 0) {
    return `I don't see any transactions to ${verb} yet — try Transactions to add one.`;
  }
  const droppedNote = describeDroppedConstraints(dropped);
  const base =
    candidates.length === 1
      ? `Found 1 matching transaction — ${verb} it?`
      : op === 'delete'
        ? `Found ${candidates.length} matching transactions — select the ones you'd like to delete.`
        : `Found ${candidates.length} matching transactions — which one would you like to ${verb}?`;
  return droppedNote ? `${droppedNote} ${base}` : base;
}

/** Multi-select delete confirm copy (docs/design/chat-transaction-delete-
 *  update-spec.md §13 amendment) — states count AND total amount so the
 *  blast radius is visible before committing, and discloses every transfer
 *  counterparty by name (spec §9.1: deleting a transfer changes a SECOND
 *  account's balance). Same "its"/"their" + comma-join convention
 *  src/domain/accountDeleteHandoff.ts already uses for the analogous
 *  account-delete disclosure — reused here rather than inventing a new
 *  phrasing. Delete-only; update never reaches this (stays single-pick). */
function txOpBatchDeleteConfirmCopy(
  summary: TransactionSelectionSummary,
  currency: string
): { title: string; body: string } {
  const plural = summary.count === 1 ? '' : 's';
  const total = formatMoney(summary.totalAmountMinor, currency);
  let body = `This permanently deletes ${summary.count} transaction${plural}, totalling ${total}.`;
  if (summary.transferCounterpartyNames.length > 0) {
    const pronoun = summary.transferCounterpartyNames.length === 1 ? 'its' : 'their';
    body += ` This includes a transfer with ${summary.transferCounterpartyNames.join(', ')}, which changes ${pronoun} balance.`;
  }
  body += " This can't be undone.";
  return { title: `Delete ${summary.count} transaction${plural}?`, body };
}

/** Delete-confirm copy — reuses the ledger's own exact wording
 *  (app/(tabs)/transactions.tsx's confirmDelete) so chat is never more or
 *  less alarming than the screen for the same action (spec §5.5). A
 *  transfer names the counterparty account (spec §9.1/edge case #14 —
 *  deleting it changes a SECOND account's balance); a posted recurring
 *  occurrence makes clear the series itself keeps running (spec §9.3). */
function txOpDeleteConfirmCopy(
  tx: Transaction,
  accountsById: Map<string, Account>
): { title: string; body: string } {
  if (tx.type === 'transfer') {
    const fromName = accountsById.get(tx.accountId)?.name ?? 'this account';
    const toName = tx.transferAccountId
      ? (accountsById.get(tx.transferAccountId)?.name ?? 'the other account')
      : 'the other account';
    return {
      title: 'Delete transfer?',
      body: `This removes the transfer between ${fromName} and ${toName}. Both balances change. This can't be undone.`,
    };
  }
  if (tx.seriesId) {
    return {
      title: 'Delete this occurrence?',
      body: 'The repeating series keeps running — only this entry is removed.',
    };
  }
  return { title: 'Delete transaction?', body: 'This removes it from your local ledger.' };
}

/** Stale-row guard (spec §5.5/§9.5) — re-read the tapped row by id and
 *  compare its fingerprint against what the picker rendered; a mismatch
 *  (edited or deleted elsewhere between render and tap) returns `null` so
 *  the caller aborts with no write. */
async function reReadTxOpCandidate(tx: Transaction): Promise<Transaction | null> {
  const fresh = await getTransaction(tx.id);
  if (!fresh) return null;
  return fingerprintsMatch(fingerprintTransaction(tx), fingerprintTransaction(fresh)) ? fresh : null;
}

const SUBTYPE_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank: 'Bank',
  credit_card: 'Credit card',
  loan: 'Loan',
  investment: 'Investment',
};

/** The confirm card's headline message for an update draft — phrased per
 *  the classified sub-operation (spec §5.2's examples). `draft.op ===
 *  'unknown'` never reaches here — the caller returns a clarify question
 *  (`buildAccountUpdateClarifyMessage`) before ever building the card (QA
 *  MINOR follow-up); the `default` case below is a defensive fallback only. */
function accountUpdateConfirmMessage(
  account: Account,
  draft: AccountUpdateDraft,
  currency: string
): string {
  switch (draft.op) {
    case 'rename':
      return `Rename "${account.name}" to "${draft.newName}"?`;
    case 'retype':
      return `Change "${account.name}" to ${SUBTYPE_LABELS[draft.newSubtype ?? ''] ?? 'a different type'}?`;
    case 'rebalance':
      return `Set "${account.name}"'s balance to ${formatMoney(draft.newBalance, currency)}?`;
    default:
      return `Update "${account.name}" — look right?`;
  }
}

// glass-phase2 §4.2: the root SafeAreaProvider (expo-router's ExpoRoot) sits
// above the NativeTabs view controllers and only ever measures the home
// indicator (34pt) — it can't see the tab VC's additionalSafeAreaInsets. A
// SafeAreaProvider nested INSIDE this screen measures its own native anchor
// instead and picks up the floating bar: insets.bottom = 83 on iPhone 17 Pro
// (measured via transactions.tsx, which every tab shares the layout with).
export default function AssistantScreen() {
  return (
    <SafeAreaProvider>
      <AssistantScreenInner />
    </SafeAreaProvider>
  );
}

function AssistantScreenInner() {
  const c = useThemeColors();
  // Responsive type/spacing scale (docs/design/responsive-scaling-spec.md) —
  // role sizes + width-aware avatar/chip/composer dimensions, re-derived on
  // rotation/split-view since it reads useWindowDimensions().
  const s = useScaledType();
  const insets = useSafeAreaInsets();
  // The design system's own gap for a floating surface — this row and the
  // tab bar are two of them, so the spacing between comes from the token
  // rather than a literal repeated at each site.
  const { tokens: glassTokens } = useGlass();
  const floatingBottomGap = glassTokens.floatingBottomGap;
  // Screen size, for the widget scan deep link's centre fallback below.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  // `insets.bottom` on this screen is the floating NativeTabs bar's inset
  // (~83pt) — its nested SafeAreaProvider reports the bar, and does NOT drop
  // to 0 when the keyboard rises. The composer no longer lives in a
  // bottom-band tray with its own animated inset, nor in the hero: it is a
  // row pinned above the bar (§12 E1), and the KeyboardAvoidingView's
  // `automaticOffset` does the keyboard maths from the view's true screen
  // frame. The only inset arithmetic left is the outer view's paddingBottom
  // near the render, which reconciles this inset against that padding.
  const router = useRouter();
  // Widget deep links: `projectxavier://?focus=1` and `?scan=1` (see
  // targets/widget and docs/design/xavier-widget-spec.md). Handled below,
  // once onScanDeepLink/inputRef exist — see the effect near its definition.
  const deepLinkParams = useLocalSearchParams<{ focus?: string; scan?: string }>();
  // The composer's text lives with the field (DraftComposer) and in this
  // ref; the screen keeps only its shape in state, so a keystroke re-renders
  // the field alone — see composerState.ts draftShape (issue #27).
  const draftRef = useRef('');
  const composerHandleRef = useRef<DraftComposerHandle>(null);
  const draftShapeRef = useRef<DraftShape>(EMPTY_DRAFT_SHAPE);
  const [draftShapeNow, setDraftShapeNow] = useState<DraftShape>(EMPTY_DRAFT_SHAPE);
  // Compared against a ref rather than left to React's same-state bailout,
  // which is not guaranteed to skip the render.
  const onDraftChange = useCallback((text: string) => {
    draftRef.current = text;
    const next = draftShape(text);
    if (sameDraftShape(draftShapeRef.current, next)) return;
    draftShapeRef.current = next;
    setDraftShapeNow(next);
  }, []);
  const setDraft = useCallback(
    (text: string) => {
      onDraftChange(text);
      composerHandleRef.current?.setText(text);
    },
    [onDraftChange]
  );
  const draftHasText = draftShapeNow.hasText;
  // Everything Xavier says is one BubbleContent (docs/design/xavier-speech-bubble-spec.md
  // §4): plain text from `setReply`, or a structured receipt from `setReceipt`.
  // It is recorded into the chat log, which the feed renders; there is no
  // single "current reply" slot on screen any more.
  // Every reply gets a stamp, and the settle timer keys on THAT rather than
  // on the text. Two consecutive replies can be byte-identical with the same
  // outcome kind — deleting two transactions in a row both say "Deleted."
  // and both set 'saved' — which React sees as no change at
  // all, so the timer would not re-arm and the first one would fire against
  // the second message. A counter has no such collisions.
  const [replyStamp, setReplyStamp] = useState(0);
  // Synchronous mirror of the stamp, for async receipts: they note it before
  // their await and only land if it has not moved (shouldApplyReceipt).
  const replyStampRef = useRef(0);
  // Today's chat log (docs/design/xavier-daily-chat-spec.md). Every user send,
  // Xavier reply and receipt, and each card shown, is written through the
  // reducer and repository; the feed renders `chatState`.
  // True while a parse / save is running: read by the log when the day clears, so
  // that operation's late results are dropped instead of landing in the new day.
  const busyRef = useRef(false);
  const {
    chat,
    state: chatState,
    loaded: chatLoaded,
    dayKey: chatDayKey,
    resetEpoch: chatResetEpoch,
    dayScope,
    notice: chatNotice,
    held: chatHeld,
    clearNotice: clearChatNotice,
  } = useChatLog(GREETING, busyRef);
  // Chat-log cards. The screen creates a card with `showCard` and then acts on
  // "the live card" (the log's newest live one, `chat.liveCardId()`): one shared
  // answer, no refs of our own to keep in step.
  const showCard = (body: CardBody | null, dataRevision?: number) => {
    if (body) chat.showCard(body, dataRevision);
  };
  // Targeting is kind-scoped: each owner names the kinds it may act on, so one
  // flow's resolve / dismiss / expire never lands on another flow's card.
  const resolveCard = (kinds: readonly ChatCardKind[], body?: CardBody | null) => {
    const id = chat.liveCardId(kinds);
    if (id) chat.resolve(id, { body: body ?? undefined, kinds });
  };
  /** Discard / Cancel / Not now. Pass `text` only where the screen shows that
   *  line; with no card (e.g. cancelling the /account Q&A) the line is still recorded. */
  const dismissCard = (kinds: readonly ChatCardKind[], text?: string) => {
    chat.dismiss(chat.liveCardId(kinds), text, kinds);
  };
  const expireCard = (kinds: readonly ChatCardKind[]) => {
    const id = chat.liveCardId(kinds);
    if (id) chat.expire(id, kinds);
  };
  const setReply = useCallback(
    (text: string, options?: { record?: boolean; logged?: boolean }) => {
      replyStampRef.current += 1;
      setReplyStamp((n) => n + 1);
      if (options?.record !== false) chat.recordXavier(textBubble(text), { logged: options?.logged });
    },
    [chat]
  );
  const setReceipt = useCallback(
    (content: BubbleContent, meta?: { logged?: boolean }) => {
      replyStampRef.current += 1;
      setReplyStamp((n) => n + 1);
      chat.recordXavier(content, meta);
    },
    [chat]
  );
  const [pending, setPending] = useState<TransactionDraft | null>(null);
  // Synchronous mirror of `pending`, read by loadContext's stale-draft guard
  // (stale-draft-spec.md §3.2). loadContext is a useCallback keyed only on
  // `router` (see its own declaration) — reading `pending` from the closure
  // there would always see the value from the render that created it (i.e.
  // permanently null), the same reason `queue` gets a ref-mirror instead of
  // being read directly (see `queueRef`).
  //
  // UNLIKE `queueRef`, this mirror is updated by a plain `useEffect` — i.e.
  // AFTER commit, one tick behind `pending` itself — rather than
  // synchronously inside a wrapped setter. `queueRef` needs the synchronous
  // version because `advanceQueueOrFinish` can be racing another in-flight
  // advance (see its own header comment: `setBusy(true)` right before an
  // await is exactly the "pending update" case where a functional updater
  // isn't guaranteed to have run yet). `pendingRef` has exactly ONE reader —
  // `loadContext`, itself only invoked on a focus event — so there is no
  // synchronous same-tick read to race: by the time a focus fires, the
  // commit (and this effect) from whatever set `pending` has long since run.
  // If `pendingRef` ever grows a second reader that needs to observe a
  // same-tick `setPending` (the way `advanceQueueOrFinish` needs
  // `queueRef`), switch it to the synchronous wrapped-setter pattern instead
  // of trusting the effect — don't assume this comment's reasoning still
  // holds for a new call site without re-checking it.
  const pendingRef = useRef<TransactionDraft | null>(null);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  // Account-creation spike: /account walks a Q&A (accountFlow), then a complete
  // draft (pendingAccount) shows a confirm card. appCurrency stamps the account.
  const [accountFlow, setAccountFlow] = useState<AccountFlowState | null>(null);
  const [pendingAccount, setPendingAccount] = useState<ReadyAccount | null>(null);
  // Chat account UPDATE (docs/design/account-chat-crud-spec.md §5.2) — an
  // editable confirm card, pre-filled with the resolved target + change.
  const [pendingAccountUpdate, setPendingAccountUpdate] = useState<PendingAccountUpdate | null>(null);
  // Chat account DELETE handoff (spec §5.3) — recognize + hand off ONLY;
  // never executes. Offers "Open in Accounts" (deep link) and an inline
  // "Archive instead" one-tap alternative.
  // On-device FM refused the text ("not a transaction"): offers "Log anyway",
  // which runs the heuristic parse on the same words. Cleared with the rest of
  // the active-draft state when anything new is sent.
  const [fmRefusal, setFmRefusal] = useState<{ text: string } | null>(null);
  const [deleteHandoff, setDeleteHandoff] = useState<DeleteHandoffState | null>(null);
  // Ask-Xavier query answer (docs/design/ask-xavier-queries-spec.md §5.4) —
  // a tool result + secondary caption, rendered as a chat answer card. Mirrors
  // pendingAccount/pendingAccountUpdate's "one card at a time" shape.
  const [queryAnswer, setQueryAnswer] = useState<QueryAnswerState | null>(null);
  // Chat transaction delete/update (docs/design/chat-transaction-delete-
  // update-spec.md §5.4/§5.6) — the picker card. `txOpNeedsAccountChoice`
  // gates a DISTINCT "which account?" step ahead of the normal picker (only
  // when the ranked list still exceeds 5 with no account resolved and more
  // than one non-archived account exists); `txOpShowAllOpen` gates the ">5"
  // sheet; `txOpUpdateEditing` is the row chosen for UPDATE, driving a
  // second TransactionFormSheet instance seeded exactly as the ledger's own
  // openEdit does (never the SAME sheet instance the pending AI draft uses —
  // the two must never be open at once).
  const [txOp, setTxOp] = useState<TxOpState | null>(null);
  const [txOpNeedsAccountChoice, setTxOpNeedsAccountChoice] = useState(false);
  const [txOpShowAllOpen, setTxOpShowAllOpen] = useState(false);
  const [txOpUpdateEditing, setTxOpUpdateEditing] = useState<Transaction | null>(null);
  const [txOpEditorError, setTxOpEditorError] = useState<string | null>(null);
  // Multi-select delete (docs/design/chat-transaction-delete-update-spec.md
  // §13 amendment) — DELETE ONLY, update stays single-pick. The set of
  // candidate ids the user has ticked; lives at screen level (not inside
  // TransactionOpPicker/TxOpShowAllSheet) so a selection made in the
  // "Show all N" sheet survives closing it back to the inline card.
  const [txOpSelectedIds, setTxOpSelectedIds] = useState<Set<string>>(new Set());
  const [appCurrency, setAppCurrency] = useState('USD');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  // A close-but-not-exact existing payee to offer as "did you mean…?".
  const [suggestion, setSuggestion] = useState<Payee | null>(null);
  // Same idea, for the category (same-kind exact/fuzzy match only).
  const [categorySuggestion, setCategorySuggestion] = useState<Category | null>(null);
  // Which engine produced the current draft — see the module-scope
  // ParseSource type above. null when there's no draft.
  const [parseSource, setParseSource] = useState<ParseSource | null>(null);
  // Which AI engines were tried and gave nothing before the basic parser
  // stepped in — read only while parseSource is 'heuristic_fallback'.
  const [aiFallbackFrom, setAiFallbackFrom] = useState<string | null>(null);
  const [busy, setBusyState] = useState(false);
  // The ref moves with the state in the same call, so a day check that lands between
  // `setBusy(true)` and the next render still sees the operation as running.
  const setBusy = useCallback((next: boolean) => {
    busyRef.current = next;
    setBusyState(next);
  }, []);
  // Last transient outcome, for the avatar's reaction.
  const [lastOutcome, setLastOutcome] = useState<AssistantOutcomeKind>(null);
  // Budget answers: the afford card and its chips, the set-budget confirm,
  // "Raise budget", and the chip a saved expense gains (monthly-budgets spec §6).
  const budget = useBudgetReplies({
    busy,
    setBusy,
    setReply,
    setReceipt,
    chat,
    setLastOutcome,
    currency: appCurrency,
    categories,
    payees,
    accounts,
    runParse,
    dayScope,
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  // "This parse was wrong" (docs/design/parse-correction-loop-spec.md) —
  // set by the card's link or the editor's toggle; when the edited draft is
  // saved, its fields are written to the on-device corrections file as an
  // eval case. Cleared with the rest of the active-draft state.
  const [reportWrong, setReportWrong] = useState(false);
  // The clock the current parse ran against (relative dates resolved from
  // it) — a correction case needs it as `nowISO`. Captured in presetDraft.
  const parseNowRef = useRef<number>(Date.now());
  // "What can I ask?" examples sheet (src/domain/assistantExamples.ts) — a row
  // in the same "All commands" popover as /account and /transactions, the ONE
  // obvious way in rather than a second competing chip on the idle hero.
  const [examplesSheetOpen, setExamplesSheetOpen] = useState(false);
  // Diagnostics: the current parse's metric id, and whether the user took the
  // payee suggestion, so the confirm step can record how the parse resolved.
  const parseIdRef = useRef<string | null>(null);
  const payeeSwappedRef = useRef(false);
  // Lets a quick-action chip / slash-menu tap re-focus the text field so the
  // keyboard comes up the same way it would if the user had tapped in.
  const inputRef = useRef<TextInput>(null);
  // Photo-source menu opened from the composer's own camera control —
  // anchored to the composer by layout (ContextMenu's `bottomRight` mode,
  // rendered as a sibling of Composer below), so it moves WITH the composer
  // as it slides under the keyboard instead of being left behind. See
  // onCameraTap.
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  // Widget deep link only (`?scan=1`, see onScanDeepLink) — there is no
  // control to anchor to there, so that one genuinely falls back to a
  // screen-centre point via ContextMenu's `point`/Modal mode, unchanged.
  const [deepLinkPhotoMenuAt, setDeepLinkPhotoMenuAt] = useState<{ x: number; y: number } | null>(
    null
  );
  // "+" menu (composer-seated-with-xavier-spec.md §4.4) — a second way to
  // open the same slash popover as typing "/", with every command plus Scan
  // photo / Add manually rows. There is no Scan row — the
  // composer's own camera glyph does that job a few points away.
  const [plusOpen, setPlusOpen] = useState(false);
  // Whether the field was empty at the moment "+" opened it — the menu only
  // auto-closes on the user typing a fresh answer (§4 edge cases: "+" tapped
  // with "/ac" already in the field must NOT close on further typing/
  // clearing, only a tap outside does).
  const plusOpenedEmptyRef = useRef(true);
  // Statement scan (docs/design/statement-scan-spec.md §4.4) — `queue` drives
  // `pending` one card at a time via currentDraft/decideCurrent while it's
  // non-null; `statementAccountChoice` holds a reconstructed layout waiting
  // on "Which account is this from?" (only shown when the user has
  // more than one account — a single-account user skips straight to the
  // queue). `statementDroppedRef` carries the "N rows couldn't be read"
  // count through to the end-of-queue summary line — the SUM of
  // `rowsToDrafts`' own `dropped` (zero-value rows) and `layout.unreadRows`
  // (amount-bearing lines inside multi-amount blocks reconstructLayout
  // excluded from `rows` outright; QA MAJOR 1 — the domain's `dropped`
  // alone under-reports these).
  const [queue, setQueueState] = useState<DraftQueue | null>(null);
  // Synchronous mirror of `queue` for the stale-advance guard in
  // advanceQueueOrFinish. A functional setState updater is NOT guaranteed
  // to run inside the dispatch (React only evaluates it eagerly when the
  // fiber has no pending update — and onStopReviewingQueue's setBusy(true)
  // right before its own advance is exactly such a pending update), so a
  // flag set inside the updater can be read before it's written. The ref
  // is written in the same tick as every setQueue and is what the guard
  // reads.
  const queueRef = useRef<DraftQueue | null>(null);
  const setQueue = (q: DraftQueue | null) => {
    queueRef.current = q;
    setQueueState(q);
  };
  const [statementAccountChoice, setStatementAccountChoice] = useState<StatementLayout | null>(
    null
  );
  // The scanned photo (uri + pixel dimensions), held for the life of the
  // review so RowSnippet can clip-and-translate it above the current draft
  // card (docs/design/row-snippet-spec.md §4.3) — set at the top of
  // scanImage once an image exists, cleared alongside the rest of the draft
  // state in resetActiveDraftState() so a new chat draft or a new scan can
  // never show the previous photo.
  const [scanSource, setScanSource] = useState<{
    uri: string;
    width: number;
    height: number;
  } | null>(null);
  const statementDroppedRef = useRef(0);
  // Real recognise+reconstruct time for the FIRST card's own recordParse
  // call (QA MINOR 10) — set once per scan in scanImage, read by
  // beginStatementQueue (which may run right away, or later once the
  // account picker resolves — a ref survives that gap; state wouldn't need
  // to, but a ref avoids an extra re-render for a value nothing renders).
  const statementScanLatencyRef = useRef(0);
  // Guards against re-firing the widget deep links on every re-render/tab
  // switch — expo-router keeps the last params around, but each of these
  // must only run once per navigation (same idiom as app/debug-fm.tsx's
  // `autoran` ref for its own deep-link param).
  const focusDeepLinkHandledRef = useRef(false);
  const scanDeepLinkHandledRef = useRef(false);
  // First-run welcome-carousel detection (flag unset && no accounts) only
  // ever runs once per app session — loadContext re-runs on every tab focus,
  // but this guards against re-triggering the carousel on a later focus,
  // e.g. right after the user finishes it (no accounts yet this render) or
  // navigates back to this tab.
  const onboardingCheckedRef = useRef(false);

  const avatarState = avatarStateFor({
    busy,
    typing: draftHasText,
    lastOutcome,
  });

  // A transient reaction — confused (error/clarify) or happy/angry
  // (saved/spent) — used to persist until the next parse, leaving Xavier
  // looking stuck. The rule (which outcomes settle and after how long) is
  // `replySettleRule` (src/domain/replySettle.ts): it settles only Xavier's
  // FACE. What he said stays in the feed as history (§6.4), and typing never
  // clears anything.
  // `replyStamp` is a dependency, not just `lastOutcome`: the timer settles
  // THIS reply, so a new one has to restart it. Saving two expenses in a row
  // sets `lastOutcome` to the same literal 'spent' twice, which React sees as
  // no change, so without the stamp the FIRST save's timer would survive to
  // fire against the second one.
  useEffect(() => {
    const rule = replySettleRule({ outcome: lastOutcome });
    if (!rule.settles) return;
    const timer = setTimeout(() => setLastOutcome(null), rule.delayMs);
    return () => clearTimeout(timer);
  }, [lastOutcome, replyStamp]);

  // Shared idle-gate for both "extra surfaces" — the composer's "+" and the
  // slash popover. Neither may render while a draft card, account draft, or
  // the /account Q&A owns the screen: they'd sit in/over the same region as
  // the confirm card and could intercept its Create/Discard taps.
  const noOverlay =
    !pending &&
    !pendingAccount &&
    !accountFlow &&
    !pendingAccountUpdate &&
    !deleteHandoff &&
    !fmRefusal &&
    !budget.reply &&
    !queryAnswer &&
    !txOp &&
    !txOpUpdateEditing &&
    !statementAccountChoice;

  // Composer visibility (src/domain/composerState.ts) — replaces the retired
  // QuickActionChips' own `showQuickActions` gate; everything those chips
  // did now lives behind "+".
  const composer = composerState({
    pending: !!pending,
    pendingAccount: !!pendingAccount,
    accountFlow: !!accountFlow,
    noOverlay,
    busy,
    typed: draftHasText,
  });

  // Slash-command popover: the typed-"/" path is unchanged (matchCommands +
  // isSlashQuery, src/domain/assistantCommands.ts) — "+" is a second way to
  // open the SAME popover, with the full catalogue plus two action rows
  // (composer-seated-with-xavier-spec.md §4.4). The typed gate is exactly
  // what it was before "+" existed — deliberately NOT filtered on
  // `matchCommands(draft).length > 0`: a typed "/x" that matches nothing
  // must still open the popover, because the pinned "What can I ask?" row
  // is the only way out of a mistyped command and it lives inside it.
  const typedSlashActive = draftShapeNow.slashQuery !== null;
  const showSlashPopover = noOverlay && (typedSlashActive || plusOpen);
  const slashRows: PlusMenuRow[] = !showSlashPopover
    ? []
    : plusOpen
      ? plusMenuRows(matchCommands(''))
      : matchCommands(draftShapeNow.slashQuery ?? '');

  // "+" opened while the field was empty auto-closes once the user starts
  // typing a fresh answer — but not if it was opened with existing text
  // already in the field (see plusOpenedEmptyRef's declaration).
  useEffect(() => {
    if (plusOpen && plusOpenedEmptyRef.current && draftHasText) {
      setPlusOpen(false);
    }
  }, [draftHasText, plusOpen]);

  // Any overlay taking the screen resets "+" — it hides right along with the
  // popover itself (`showSlashPopover` above already gates on `noOverlay`),
  // but this keeps the boolean itself from lingering true underneath.
  useEffect(() => {
    if (!noOverlay) setPlusOpen(false);
  }, [noOverlay]);

  // The photo menu hangs off the camera glyph, and that glyph goes away for
  // more reasons than a tap: typing one character morphs it into Send, a
  // parse makes the composer busy, and a draft card unmounts the composer
  // outright. Left open the menu floats over the greeting attached to a
  // control that is not there — and because the boolean outlives the
  // unmounted view, it would reappear by itself when the card cleared.
  // `showCamera` is exactly "the anchor exists", so key on it.
  useEffect(() => {
    if (!composer.showCamera) setPhotoMenuOpen(false);
  }, [composer.showCamera]);


  // `keyboardUp` — the one thing the bottom clearance depends on, and
  // deliberately NOT the field's focus. Those are different questions: with
  // a hardware keyboard attached the field takes focus and no software
  // keyboard ever appears, so a focus-keyed clearance collapsed with nothing
  // rendered to fill it and the row sat under the tab bar. Focus was the
  // wrong signal in three earlier bugs on this screen too — a draft card
  // unmounting the field, a tab switch, and a colour-scheme flip remounting
  // every Glass — each of which stranded a focus flag true with no keyboard,
  // and each of which got its own patch. Asking the keyboard directly
  // retires all of them: it is the thing the layout actually cares about.
  // Stored as a HEIGHT, not a boolean: the KeyboardAvoidingView pads by the
  // keyboard's actual frame, and that frame is not always full height — a
  // hardware keyboard's shortcut bar reports `keyboardDidShow` at ~50pt. A
  // boolean would drop the clearance to its floor for that too, leaving the
  // row inside the tab bar's band again, which is the same bug one size
  // smaller. Subtracting the real height covers the whole range.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setKeyboardHeight(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);


  // The tapped point is no longer needed — it only ever anchored the Scan
  // row's photo menu, and that row is gone. The popover itself is positioned
  // relative to the composer, not to the touch.
  const onPlus = () => {
    plusOpenedEmptyRef.current = draftRef.current.trim() === '';
    // One popover at a time. Both anchor to the same bottom edge and grow
    // upward, so open together the later one paints over the other's rows —
    // and an RN View hit-tests whatever is on top, so those rows would not
    // just be hidden, they would be untappable. The Modal used to make this
    // impossible for free.
    setPhotoMenuOpen(false);
    setPlusOpen(true);
  };

  // The hero's own backdrop tap (§4.4 "tap outside dismisses it") also
  // dismisses the keyboard, same as tapping away from any text field
  // elsewhere in the app. Without this, `keyboardShouldPersistTaps="handled"`
  // (needed so the tap reaches this Pressable instead of just dismissing the
  // keyboard on its own) means a background tap would leave the field's
  // native focus alone. `Keyboard.dismiss()` (not `inputRef.current?.blur()`,
  // which does not reliably resign first responder here) is a no-op when
  // nothing is focused, so it is safe to call unconditionally.
  const onHeroBackgroundPress = () => {
    if (plusOpen) setPlusOpen(false);
    // The photo-source menu lost its own tap-outside-to-dismiss backdrop
    // when it stopped being a `Modal` (see onCameraTap) — fold it into the
    // same background tap "+" already uses.
    if (photoMenuOpen) setPhotoMenuOpen(false);
    Keyboard.dismiss();
  };

  // "Add manually" row — the exact call the retired chip made; transactions.
  // tsx's `?add` token guard still applies.
  const onPlusAddManually = () => {
    setPlusOpen(false);
    router.push(`/transactions?add=${Date.now()}`);
  };

  // The field doubles as the /account Q&A's answer box, so its placeholder
  // should match what's being asked instead of the general prompt below.
  // Idle copy is "Ask Xavier" (not "Describe an expense") because the field
  // now takes questions and account commands too, not just expenses.
  const inputPlaceholder = !accountFlow
    ? 'Ask Xavier'
    : accountFlow.step === 'subtype'
      ? '…or type your own' // chips are visible on this step
      : 'Type your answer…';

  // Stable object identity while the same draft is open — prevents
  // TransactionFormSheet from re-seeding state on every re-render (e.g. when
  // setBusy(true) fires during save). Only changes when `pending` changes.
  const editorInitial = useMemo<FormValues | null>(
    () =>
      pending
        ? {
            accountId: pending.accountId,
            transferAccountId: pending.transferAccountId ?? '',
            type: pending.type,
            amountMinor: pending.amount,
            date: pending.occurredAt,
            categoryName: pending.categoryName ?? '',
            payeeName: pending.payeeName ?? '',
            note: pending.note ?? '',
            repeatRule: null,
            seriesId: null,
            occurrenceDate: null,
            // Pre-set from the FM's guard-checked pending proposal (e.g.
            // "pending $40 dinner") when present; the user can still flip
            // this in the editor before confirming.
            pending: pending.pending ?? false,
          }
        : null,
    [pending]
  );

  // Lookups for the tx_op picker's rows and the update-editor's seed values
  // (docs/design/chat-transaction-delete-update-spec.md §5.4/§5.5) — mirrors
  // app/(tabs)/transactions.tsx's own accountsById/categoriesById/payeesById.
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const payeesById = useMemo(() => new Map(payees.map((p) => [p.id, p])), [payees]);

  // Same "stable identity while open" convention as `editorInitial` above —
  // a SECOND, independent FormValues seed for editing an EXISTING, already-
  // saved transaction (mode: 'edit'), never the pending AI draft's own sheet.
  const txOpUpdateInitial = useMemo<FormValues | null>(() => {
    if (!txOpUpdateEditing) return null;
    const tx = txOpUpdateEditing;
    return {
      accountId: tx.accountId,
      transferAccountId: tx.transferAccountId ?? '',
      type: tx.type,
      amountMinor: tx.amount,
      date: tx.occurredAt,
      categoryName: tx.categoryId ? (categoriesById.get(tx.categoryId)?.name ?? '') : '',
      payeeName: tx.payeeId ? (payeesById.get(tx.payeeId)?.name ?? '') : '',
      note: tx.note ?? '',
      repeatRule: null,
      seriesId: tx.seriesId ?? null,
      occurrenceDate: tx.occurrenceDate ?? null,
      pending: tx.pending,
    };
  }, [txOpUpdateEditing, categoriesById, payeesById]);

  // Load accounts, categories, and payees; no feed list.
  // Runs on focus so data from other tabs shows up too.
  const loadContext = useCallback(async () => {
    // The day this read started on (see `dayEpoch`): a reset while it awaits skips the stale-draft reply.
    const stillToday = dayScope();
    // Claimed synchronously, before any await, so the once-only guard is
    // actually race-proof — a rapid double-focus (two overlapping calls)
    // can't both see it unclaimed and double-navigate to /welcome. Released
    // again in the catch below if this call doesn't make it all the way to
    // the onboarding check — a transient DB hiccup on the very first focus
    // must not permanently strand the ref as "checked" while the check
    // itself never ran, which would silently suppress the carousel for the
    // rest of the session; the next focus gets another shot instead.
    const shouldCheckOnboarding = !onboardingCheckedRef.current;
    onboardingCheckedRef.current = true;

    try {
      const [accts, cats, pays] = await Promise.all([
        listAccounts(),
        listCategories(),
        listPayees(),
      ]);
      setAccounts(accts);
      setCategories(cats);
      setPayees(pays);
      setAppCurrency(await getCurrency());

      // Stale tx_op picker guard (spec §9.5) — every focus (including a
      // return from the Transactions tab) re-checks the data revision the
      // picker was built against; a write anywhere else clears it rather
      // than leaving a row on screen that no longer matches the ledger.
      const revision = await getDataRevision();
      chat.noteRevision(revision);
      setTxOp((p) => (p && p.dataRevision !== revision ? null : p));
      // Same for a budget card: its figures were computed against the ledger
      // as it stood, so a write elsewhere (a transaction, a budget, a deleted
      // category) makes it stale.
      budget.dropStaleReply(revision);

      // Stale pending-draft/queue guard (stale-draft-spec.md §3.2) — the
      // sibling of the txOp check above, but RE-VALIDATING rather than
      // blanket-clearing: the common case is the user just visiting another
      // tab and coming back, and wiping a draft they typed for that reason
      // alone would be its own bug. Only clear (with an explanation) when
      // the card's account is actually gone or its currency actually
      // changed — `checkDraftIntegrity` is the exact same check
      // `saveAssistantDraft` refuses a write on (see draftIntegrity.ts), so
      // this reads as "if Save would have refused this, don't wait for
      // the user to tap Save to find out."
      if (pendingRef.current && stillToday()) {
        const status = checkDraftIntegrity(pendingRef.current, accts);
        if (status !== 'ok') await explainStaleDraft(status);
      }

      // First-run detection (build 39: docs/design/onboarding-carousel-spec.md
      // — "on first launch after the DB is ready and (if enabled) unlock
      // passes", already guaranteed here since this screen only ever renders
      // behind app/_layout.tsx's ready+unlocked gate). Only ever checked once
      // per session: flag unset AND no accounts yet shows the welcome
      // carousel; a flag already set, or accounts already present (an
      // existing user upgrading), leaves the screen alone.
      if (shouldCheckOnboarding) {
        const done = await getOnboardingComplete();
        if (!done && accts.length === 0) {
          router.push('/welcome');
        }
      }
    } catch (e) {
      if (shouldCheckOnboarding) onboardingCheckedRef.current = false;
      throw e;
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      loadContext();
    }, [loadContext])
  );

  // Shared by runParse and scanImage (docs/design/unified-scan-spec.md §4.2,
  // building on statement-scan-spec.md §4.4 point 7: "starting a statement
  // scan clears a pending chat draft/queue") — whichever gate/parse fires
  // next owns the screen, so any pending draft, statement queue, or tx_op
  // picker from a previous attempt is cleared before the new one runs.
  function resetActiveDraftState() {
    // A statement queue's current card has an unresolved 'layout' metric row
    // (recordLayoutParse) — abandoning the queue by starting a new chat
    // message or a new scan, rather than tapping Save/Skip/Stop reviewing,
    // must still resolve it, or it stays open forever (MINOR 5, QA). The
    // chat path's own single pending draft is left as-is (unchanged
    // behaviour) — only the statement queue gets this treatment.
    if (queue && parseIdRef.current) {
      void resolveParse(parseIdRef.current, { resolved: 'discarded' });
    }
    // Same for an FM refusal left on screen: moving on accepts it.
    if (fmRefusal && parseIdRef.current) {
      void resolveParse(parseIdRef.current, { resolved: 'discarded' });
    }
    // Last resort for the chat log: whatever card is still live was left behind
    // (success and discard sites have already named theirs).
    chat.abandonLive();
    // Every card flow, not just the draft: the next gate hit owns the screen,
    // so no other flow's card can linger beside it (one live card).
    setPending(null);
    setPendingAccount(null);
    setPendingAccountUpdate(null);
    setDeleteHandoff(null);
    setSuggestion(null);
    setCategorySuggestion(null);
    setParseSource(null);
    setLastOutcome(null);
    setEditorOpen(false);
    setEditorError(null);
    setReportWrong(false);
    setQueryAnswer(null);
    setFmRefusal(null);
    budget.clear();
    setQueue(null);
    setStatementAccountChoice(null);
    setScanSource(null);
    statementDroppedRef.current = 0;
    // A fresh message replaces whatever the tx_op picker/editor was showing
    // — same "the newest gate hit owns the screen" discipline as the resets
    // above, and guards the "the two sheets must never be open at once"
    // invariant (spec §5.5) against a message sent while the update-editor
    // sheet happened to still be open.
    setTxOp(null);
    setTxOpNeedsAccountChoice(false);
    setTxOpShowAllOpen(false);
    setTxOpUpdateEditing(null);
    setTxOpEditorError(null);
    setTxOpSelectedIds(new Set());
    parseIdRef.current = null;
    payeeSwappedRef.current = false;
  }

  // Clear a card (or stop/skip within a statement queue) that the data
  // underneath it has outgrown (stale-draft-spec.md §3.2) — the account it
  // points at is gone, or its currency was relabelled since the card was
  // built. Called both from loadContext's focus-time re-validation and from
  // onConfirm/onEditSave's save-time catch (assertDraftIsSaveable can
  // discover the exact same thing a moment later, via saveAssistantDraft)
  // so the explanation reads identically regardless of when it's caught.
  // Never a silent clear/skip: a reply always says why. Async (and every
  // call site awaits it) because the mid-queue branch below awaits
  // `advanceQueueOrFinish`.
  const explainStaleDraft = async (status: Exclude<DraftIntegrityStatus, 'ok'>) => {
    // A day reset during its await drops the reply: it explains a card of the old day.
    const stillToday = dayScope();
    void resolveParse(parseIdRef.current, { resolved: 'discarded' });
    parseIdRef.current = null;
    setEditorOpen(false);
    setEditorError(null);

    // 'transfer-account-gone' is PER-ROW (beginStatementQueue's rows share
    // one base account, but a suspected-transfer row's OWN destination is
    // resolved independently per row — see rowsToDrafts/buildDraftForRow in
    // statementDrafts.ts) — unlike 'account-gone'/'currency-changed', which
    // are the queue's shared base account and so invalidate every remaining
    // row identically. Stopping a 30-row review because ONE row's transfer
    // guess went stale would cost every other, unaffected row; skip just
    // this card instead, the same as a manual Skip, and keep reviewing.
    if (status === 'transfer-account-gone' && queueRef.current) {
      setSuggestion(null);
      setCategorySuggestion(null);
      setParseSource(null);
      await advanceQueueOrFinish(decideCurrent(queueRef.current, 'skipped'));
      if (!stillToday()) return;
      // Its own line, so the user learns why this one row disappeared. The
      // queue's "3 of 6" progress label lives on the card, not in the chat, so
      // it is never baked into this stored line.
      setReply('The account this row was moving money to is gone now — skipping it.');
      setLastOutcome('clarify');
      return;
    }

    // Past the per-row skip above, the card (or the whole queue) is out of
    // date: its stub says so.
    expireCard(DRAFT_KINDS);

    const explanation =
      status === 'account-gone'
        ? "That account's gone now — tell me again?"
        : status === 'transfer-account-gone'
          ? "The account you moved this to is gone now — tell me again?"
          : "This account's currency changed since I asked — tell me again so I get it right?";
    setSuggestion(null);
    setCategorySuggestion(null);
    setParseSource(null);
    if (queueRef.current) {
      // The whole queue shares one destination account (beginStatementQueue
      // takes a single `account`), so this card's account is every
      // remaining card's account too — stop the review rather than losing
      // rows one at a time. `stopReviewing` marks every undecided card
      // 'skipped' (not silently dropped — `statementSummary` still counts
      // them) before the queue itself is torn down.
      const finished = stopReviewing(queueRef.current);
      setQueue(null);
      setReply(`${explanation} ${statementSummary(finished, statementDroppedRef.current)}`);
      statementDroppedRef.current = 0;
    } else {
      setReply(explanation);
    }
    setPending(null);
    // 'clarify' (→ the "confused" face, self-clears after 4s — see the
    // effect above) fits better than 'error': Xavier isn't failing, it's
    // asking again because the world moved under the card.
    setLastOutcome('clarify');
  };

  async function runParse(
    text: string,
    options?: { forceExpense?: boolean; heuristicOnly?: boolean }
  ) {
    if (!text.trim() || busy) return;
    setBusy(true);
    resetActiveDraftState();
    const trimmed = text.trim();
    // An afford "Log it" presets its budget's category on the draft (the user
    // asked about THAT budget); consumed once, here.
    const presetCategory = budget.presetCategoryRef.current;
    budget.presetCategoryRef.current = null;
    // Every engine's confirm draft passes through here (the FM, BYOK and
    // heuristic paths below all call it), so this is the one post-step after
    // interpret() — which stays pure — where the user's own history gets a
    // say: the payee's remembered category/account replace the engine's
    // proposal (domain/learnedDefaults.ts, flagged on the card with a
    // revert), unless the user typed the category themselves. `trimmed` is
    // the user's own words, for that typed-wins check. Runs BEFORE the
    // budget preset so an explicit afford "Log it" still wins over history.
    const presetDraft = (d: TransactionDraft): TransactionDraft => {
      parseNowRef.current = now;
      const learned = applyLearnedDefaults(d, {
        payees: pays,
        categories: cats,
        accounts: accts,
        text: trimmed,
      });
      if (!presetCategory || learned.type !== 'expense') return learned;
      // Keep a more specific subcategory the parse found under this budget.
      const name = presetCategoryName(learned.categoryName, presetCategory, cats);
      return name === null
        ? learned
        : { ...clearLearnedCategoryFlag(learned), categoryName: name };
    };
    const startedAt = Date.now();
    // Ask-Xavier query gate (docs/design/ask-xavier-queries-spec.md §5.1) —
    // runs BEFORE the account-creation gate below (and, transitively, before
    // the expense ladder): a question/report shape always wins even when the
    // tail could also satisfy the account gate (e.g. "show me how to add an
    // account" — see tests/intent-corpus.jsonl). Same forceExpense bypass as
    // the account gate.
    const queryIntent = options?.forceExpense ? null : detectQueryIntent(trimmed);
    // Deterministic account-creation gate (docs/design/account-chat-creation-
    // spec.md §5.1) — checked BEFORE the expense parse ladder below, alongside
    // the /account command and mid-Q&A checks already handled in onSend (an
    // explicit "/account" always wins outright; this is what makes an ordinary
    // free-text one-shot ALSO reach account creation). The model never decides
    // intent — only this pure, synchronous check does (probe finding #1).
    // `forceExpense` (set by the explicit "/transactions <text>" command in
    // onSend) skips the gate entirely — "explicit command wins" applies just
    // as much to a forced expense as to an explicit "/account".
    const accountIntent = options?.forceExpense ? null : detectAccountIntent(trimmed);
    // Transaction-op candidacy gate (docs/design/chat-transaction-delete-
    // update-spec.md §5.1) — checked LAST, after both gates above (a
    // query-shaped or account-shaped lead always wins — same ordering
    // src/domain/intentGate.ts's `detectIntent` composes for the corpus
    // suite). `forceExpense` skips this gate too, same as the other two.
    const txOpCandidate =
      options?.forceExpense || queryIntent || accountIntent
        ? null
        : detectTransactionOpCandidate(trimmed);
    // Hoisted so the heuristic fallback and catch-block reuse the same
    // grounding data and clock as the FM attempt.
    let accts: Account[] = [];
    let cats: Category[] = [];
    let pays: Payee[] = [];
    let now = startedAt;
    // Which engine the router-driven loop is currently trying, so the outer
    // catch below (a throw from inside ENGINE_RUNNERS[engine]()) can label
    // the metric with the engine that actually failed instead of guessing
    // on_device/heuristic — set right before each attempt, read only in the
    // catch block.
    let currentEngine: EngineId | null = null;
    // True once an AI engine was tried and fell through, so the basic
    // parser's draft says so instead of passing itself off as "Offline"
    // (user report, build 125: a transfer on a capable, online phone).
    let heuristicAfterAi = false;
    // Computed once per runParse (not per fallback branch) and threaded onto
    // every recordParse call so the metric shows whether the on-device tier
    // was even an option, regardless of which engine actually served the parse.
    let deviceAiCapable = false;
    // Why the on-device tier produced nothing, recorded on the row of whichever
    // engine took over (fmFallbackDetail) so a soak can measure the throw rate.
    let fmFallbackReason: FmFallbackReason | null = null;

    // FM-first tier — the DEFAULT (and only AI) parse engine: parse on-device
    // with Apple Foundation Models whenever the device supports it (private,
    // no network). Returns true when it produced a usable parse
    // (isUsefulDeviceParse) OR a refusal (reply + "Log anyway" already shown);
    // otherwise (failed, or forceExpense refused) the caller falls through to the
    // deterministic heuristic floor below.
    async function runFmParse(): Promise<boolean> {
      if (!deviceAiCapable) return false;
      const fmOutcome = await deviceParse(trimmed, {
        categories: cats,
        payees: pays,
        accounts: accts,
        now,
        currency: appCurrency,
      }, { forceExpense: options?.forceExpense });
      // A valid result with no usable amount is the model REFUSING ("not a
      // transaction"), not a failure: say so and offer "Log anyway" instead of
      // silently handing the text to the heuristic (which would turn "should I
      // pay $50 for dinner?" into a confirmable expense).
      if (fmOutcome.kind === 'refused') {
        setReply(FM_REFUSAL_REPLY);
        setLastOutcome('clarify');
        setFmRefusal({ text: trimmed });
        parseIdRef.current = await recordParse({
          engine: 'on_device',
          outcome: 'refused',
          inputLenBucket: inputLenBucket(trimmed.length),
          groundingCounts: fmOutcome.cue ? notTransactionCueDetail(fmOutcome.cue) : null,
          deviceAiCapable: true,
          latencyMs: Date.now() - startedAt,
        });
        return true;
      }
      // Only a `parsed` outcome is accepted; `failed` falls through.
      if (fmOutcome.kind === 'parsed') {
        const fm = fmOutcome.parse;
        const outcome = interpret(fm, { accounts: accts, now, text: trimmed });
        setReply(outcome.message);

        const metricOutcome: ParseOutcome =
          outcome.kind === 'confirm'
            ? 'confirm'
            : outcome.kind === 'blocked'
              ? 'blocked'
              : outcome.missing.length > 0
                ? 'clarify_missing'
                : 'clarify_lowconf';
        parseIdRef.current = await recordParse({
          engine: 'on_device',
          outcome: metricOutcome,
          confidenceBucket: confidenceBucket(fm.confidence),
          inputLenBucket: inputLenBucket(trimmed.length),
          deviceAiCapable: true,
          latencyMs: Date.now() - startedAt,
        });

        if (outcome.kind === 'confirm') {
          // Attach the user's words so they persist on save (sourceText).
          const drafted = presetDraft(outcome.draft);
          setPending({ ...drafted, sourceText: trimmed });
          showCard(draftCard({ ...drafted, sourceText: trimmed }, accts));
          setParseSource('on_device');
          // Same local fuzzy reconcile as the heuristic-success path below.
          if (outcome.draft.payeeName) {
            const { suggestion: near } = findPayeeMatch(outcome.draft.payeeName, pays);
            setSuggestion(near ?? null);
          }
          if (drafted.categoryName) {
            const { suggestion: nearCat } = findCategoryMatch(
              drafted.categoryName!,
              outcome.draft.type,
              cats
            );
            setCategorySuggestion(nearCat ?? null);
          }
        } else {
          // clarify / blocked → confused reaction
          setLastOutcome('clarify');
        }
        return true;
      }
      // No usable on-device result (not capable, session/generation failure,
      // or output failed schema validation).
      if (fmOutcome.kind === 'failed') fmFallbackReason = fmOutcome.reason ?? null;
      return false;
    }

    // BYOK cloud tier (docs/design/byok-spec.md) — parses with the user's own
    // OpenAI/Anthropic key. Only ever reached when parseRouter.routeEngines
    // put `provider` ahead of/instead of the on-device tiers (BYOK on, a key
    // is saved, and the device looked online) — see the router-driven loop
    // below. Mirrors runFmParse's shape exactly; the only difference is which
    // function does the parsing and which ParseSource/metric label it uses.
    // Never throws to the caller: openaiParse/anthropicParse swallow every
    // failure (bad key, offline, timeout, rate limit, schema-invalid output)
    // into a `null` return, so a cloud hiccup always falls through to the
    // next engine in the order instead of surfacing an error.
    async function runCloudParse(provider: ByokProvider): Promise<boolean> {
      const apiKey = await getByokKey(provider);
      // Belt-and-braces: the router already required a saved key before
      // putting `provider` in the order, but never trust that blindly here.
      if (!apiKey) return false;
      const modelId = await getByokModel(provider);
      const parseFn = provider === 'openai' ? openaiParse : anthropicParse;
      // EXPENSE_PARSE_CONTRACT passed explicitly — fetchOpenAiRaw/
      // fetchAnthropicRaw no longer default it (reviewer follow-up: a
      // defaulted generic contract could only be expressed with an unsound
      // `as unknown as` cast).
      const parsed: AiParsedExpense | null = await parseFn(
        trimmed,
        { categories: cats, payees: pays, accounts: accts, now },
        apiKey,
        modelId,
        EXPENSE_PARSE_CONTRACT
      );
      if (!parsed || !isUsefulDeviceParse(parsed)) return false;

      const outcome = interpret(parsed, { accounts: accts, now, text: trimmed });
      setReply(outcome.message);

      const metricOutcome: ParseOutcome =
        outcome.kind === 'confirm'
          ? 'confirm'
          : outcome.kind === 'blocked'
            ? 'blocked'
            : outcome.missing.length > 0
              ? 'clarify_missing'
              : 'clarify_lowconf';
      parseIdRef.current = await recordParse({
        engine: provider,
        outcome: metricOutcome,
        confidenceBucket: confidenceBucket(parsed.confidence),
        inputLenBucket: inputLenBucket(trimmed.length),
        deviceAiCapable,
        latencyMs: Date.now() - startedAt,
      });

      if (outcome.kind === 'confirm') {
        const drafted = presetDraft(outcome.draft);
        setPending({ ...drafted, sourceText: trimmed });
        showCard(draftCard({ ...drafted, sourceText: trimmed }, accts));
        setParseSource(provider);
        if (outcome.draft.payeeName) {
          const { suggestion: near } = findPayeeMatch(outcome.draft.payeeName, pays);
          setSuggestion(near ?? null);
        }
        if (drafted.categoryName) {
          const { suggestion: nearCat } = findCategoryMatch(
            drafted.categoryName!,
            outcome.draft.type,
            cats
          );
          setCategorySuggestion(nearCat ?? null);
        }
      } else {
        setLastOutcome('clarify');
      }
      return true;
    }

    // Heuristic floor — deterministic on-device parse (no model, no network).
    // The last resort when FM is unavailable or couldn't produce a usable
    // parse. Returns false only when its own output fails validation, so the
    // caller can show a generic error instead of building a draft from
    // untrusted/malformed data.
    async function runHeuristicParse(): Promise<boolean> {
      // Treat the heuristic's own output as untrusted too (guardrail #6) —
      // heuristicExpense safeParses so a malformed local parse can never throw.
      const validated = heuristicExpense(trimmed, {
        categories: cats,
        payees: pays,
        now,
        currency: appCurrency,
      });
      if (!validated) return false;
      const outcome = interpret(validated, { accounts: accts, now, text: trimmed });
      setReply(outcome.message);

      const metricOutcome: ParseOutcome =
        outcome.kind === 'confirm'
          ? 'confirm'
          : outcome.kind === 'blocked'
            ? 'blocked'
            : outcome.missing.length > 0
              ? 'clarify_missing'
              : 'clarify_lowconf';
      // Thread the parse id like the FM path so onConfirm/onDiscard/
      // onEditSave can resolveParse() it — otherwise the heuristic engine's
      // save/edit rates (the whole point of the metric) are never recorded.
      parseIdRef.current = await recordParse({
        engine: 'heuristic',
        outcome: metricOutcome,
        inputLenBucket: inputLenBucket(trimmed.length),
        // Only this (heuristic) row carries the reason; a BYOK engine that took
        // over after a failed on-device tier does not (see fmFallbackDetail).
        groundingCounts: fmFallbackReason ? fmFallbackDetail(fmFallbackReason) : null,
        deviceAiCapable,
        latencyMs: 0,
      });

      if (outcome.kind === 'confirm') {
        // Attach the user's words so they persist on save (sourceText).
        const drafted = presetDraft(outcome.draft);
        setPending({ ...drafted, sourceText: trimmed });
        showCard(draftCard({ ...drafted, sourceText: trimmed }, accts));
        setParseSource(heuristicAfterAi ? 'heuristic_fallback' : 'heuristic');
        // Same local fuzzy reconcile as the FM-success path above.
        if (outcome.draft.payeeName) {
          const { suggestion: near } = findPayeeMatch(outcome.draft.payeeName, pays);
          setSuggestion(near ?? null);
        }
        if (drafted.categoryName) {
          const { suggestion: nearCat } = findCategoryMatch(
            drafted.categoryName!,
            outcome.draft.type,
            cats
          );
          setCategorySuggestion(nearCat ?? null);
        }
      } else {
        // clarify / blocked → confused reaction
        setLastOutcome('clarify');
      }
      return true;
    }

    try {
      // Ground the parse in the user's existing data so the model maps to
      // real entities instead of inventing duplicates.
      [accts, cats, pays] = await Promise.all([
        listAccounts(),
        listCategories(),
        listPayees(),
      ]);
      setAccounts(accts);
      setCategories(cats);
      setPayees(pays);
      now = Date.now();

      // Budget gate (docs/design/monthly-budgets-spec.md §6.1) — an afford
      // question with an amount, or a set / edit / remove budget command the
      // deterministic router reads. Runs BEFORE the query gate's handling and
      // the not-a-transaction cues (those would refuse both), is pure text
      // routing (the model never decides it), and falls through unchanged for
      // anything else. `forceExpense` skips it, like every other gate. The
      // model-assisted fallback for wording the router misses is further down,
      // after the query, account and transaction-op gates have declined.
      const budgetIntent: BudgetIntent | null = options?.forceExpense
        ? null
        : detectBudgetIntent(trimmed, cats);
      if (budgetIntent) {
        await budget.answerIntent(budgetIntent, cats, pays, now);
        return;
      }
      // Computed once and reused by every recordParse call below (every
      // tier) so the metric captures whether Foundation Models were even an
      // option for this parse, regardless of which engine actually served it.
      deviceAiCapable = await isDeviceAiAvailable();

      // Resolve the BYOK config (docs/design/byok-spec.md) — a config saying
      // "enabled" with no key actually saved for the chosen provider must be
      // treated as off (resolveByokEnabled), so a stale toggle never routes
      // to a provider with nothing to call. Every Keychain/network touch
      // below is itself gated on the raw toggle being on, so leaving BYOK
      // off costs this parse nothing extra — same fully-local default as
      // before BYOK existed.
      const [byokEnabledConfig, byokProvider] = await Promise.all([
        getByokEnabled(),
        getByokProvider(),
      ]);
      const hasKey =
        byokEnabledConfig && byokProvider ? await hasByokKey(byokProvider) : false;
      // Only probe connectivity when the provider could actually run — a
      // best-effort latency optimisation (src/features/ai/network.ts), never
      // a correctness requirement: the cloud engine's own timeout/null-on-
      // failure already falls through to the next tier even if this guess is
      // wrong.
      const online =
        byokEnabledConfig && byokProvider && hasKey ? await isOnline() : false;

      // "Log anyway" after an FM refusal runs ONLY the heuristic on the
      // refused text — no engine gets a second chance to refuse.
      const engineOrder: EngineId[] = options?.heuristicOnly
        ? ['heuristic']
        : routeEngines({
            deviceAiCapable,
            byok: { enabled: resolveByokEnabled(byokEnabledConfig, hasKey), provider: byokProvider },
            online,
          });

      // Ask-Xavier query gate hit (docs/design/ask-xavier-queries-spec.md
      // §5.3) — runs BEFORE the account-intent branches below (spec §5.1).
      // Read-only: every branch below only ever CALLS a tool and renders its
      // result, never writes anything.
      if (queryIntent) {
        const txs = await listTransactions();
        const toolCtx: QueryToolContext = {
          accounts: accts,
          transactions: txs,
          categories: cats,
          payees: pays,
          now,
        };
        const executeTool = (tool: QueryToolName, params: Record<string, unknown>) =>
          executeQueryTool(toolCtx, { tool, params } as QueryToolCall);

        let served: {
          call: QueryToolCall;
          result: unknown;
          caption: string | null;
          servedBy: 'openai' | 'anthropic' | 'on_device' | 'floor';
          // Set only for a BYOK multi-call comparison — see
          // `buildQueryComparison`'s header and the render site below.
          comparison: QueryComparison | null;
        } | null = null;

        for (const engine of engineOrder) {
          if (engine === 'heuristic') break; // handled by the floor fallback below
          if (engine === 'foundation') {
            const rawCall = await deviceParseQuerySelection(trimmed);
            if (rawCall) {
              // Deterministic period override (docs/design/ask-xavier-
              // queries-spec.md, QA device bug build 57) — the user's own
              // words always win over the model's chosen period token.
              const call = applyDeterministicPeriodOverride(rawCall, trimmed, now);
              const result = executeQueryTool(toolCtx, call);
              served = {
                call,
                result,
                caption: buildDeterministicQueryCaption(call, result),
                servedBy: 'on_device',
                comparison: null,
              };
              break;
            }
            continue;
          }
          // BYOK provider ('openai' | 'anthropic') — the multi-round tool loop.
          const apiKey = await getByokKey(engine);
          if (!apiKey) continue;
          const modelId = await getByokModel(engine);
          const loopResult = await runQueryLoop(
            engine,
            trimmed,
            apiKey,
            modelId,
            now,
            appCurrency,
            executeTool
          );
          if (loopResult && loopResult.calls.length > 0) {
            // A composed multi-call answer ("compare my spending in 2025 vs
            // 2026") renders as a COMPARISON CHART, not a single-result card
            // (device bug, build 58 — see queryComparison.ts's header): when
            // the loop's own calls form a genuine same-tool/different-
            // period/single-scalar-amount comparison, every call's amount
            // (never the narration) drives one bar per period. Otherwise
            // (a single call, or a shape buildQueryComparison doesn't
            // recognise) this falls back to exactly today's behavior —
            // the LAST call's own card. Either way the model's narration
            // still renders as the secondary caption underneath.
            const comparison = buildQueryComparison(loopResult.calls);
            const last = loopResult.calls[loopResult.calls.length - 1]!;
            served = {
              call: { tool: last.tool, params: last.params } as QueryToolCall,
              result: last.result,
              caption: loopResult.narration,
              servedBy: engine,
              comparison,
            };
            break;
          }
        }

        if (!served) {
          // No engine served it — try the deterministic floor's canned
          // patterns before giving up entirely (spec §5.3 point 3).
          const floorCall = resolveFloorQueryCall(trimmed, now);
          if (floorCall) {
            const result = executeQueryTool(toolCtx, floorCall);
            served = {
              call: floorCall,
              result,
              caption: buildDeterministicQueryCaption(floorCall, result),
              servedBy: 'floor',
              comparison: null,
            };
          }
        }

        if (served) {
          const answered = {
            tool: served.call.tool,
            result: served.result,
            caption: served.caption,
            comparison: served.comparison,
          };
          setQueryAnswer(answered);
          setReply("Here's what I found.");
          showCard(queryAnswerCard(answered, appCurrency));
          parseIdRef.current = await recordParse({
            engine: served.servedBy,
            outcome: 'answered',
            intent: 'query',
            tool: served.call.tool,
            inputLenBucket: inputLenBucket(trimmed.length),
            deviceAiCapable,
            latencyMs: Date.now() - startedAt,
          });
        } else {
          // A query-gate hit no tier could serve — answer honestly rather
          // than showing the confused face on a read-only ask (spec §5.3).
          setReply(
            'I can answer things like "how much did I spend this month", ' +
              '"show my spending breakdown", or "what\'s my net worth".'
          );
          setLastOutcome('clarify');
          parseIdRef.current = await recordParse({
            // No tier answered — including the floor's own canned patterns —
            // so, like the account gate's ACCOUNT_ENGINE_METRIC_LABEL
            // convention, this is labeled 'floor' rather than a specific
            // engine: no real extraction/tool-selection call ever produced
            // a usable result here.
            engine: 'floor',
            outcome: 'no_match',
            intent: 'query',
            inputLenBucket: inputLenBucket(trimmed.length),
            deviceAiCapable,
            latencyMs: Date.now() - startedAt,
          });
        }
        return;
      }

      // Account-intent gate hit (docs/design/account-chat-crud-spec.md §4) —
      // `op` decides which of the three flows below runs. The model NEVER
      // decides `op`; only the deterministic gate does.
      if (accountIntent?.op === 'create') {
        // Account-creation gate hit (docs/design/account-chat-creation-spec.md
        // §5.4) — runs the SAME engine order as the expense ladder below, but
        // extracts {name, subtype} via the account contract instead. Every hit
        // lands on the (editable) confirm card, never a question — even fully
        // offline/no-key/FM-incapable, where the "deterministic floor" is
        // simply "no extraction call at all", not a heuristic parse.
        let extracted: AccountExtraction | null = null;
        let servedBy: EngineId = 'heuristic';
        for (const engine of engineOrder) {
          if (engine === 'heuristic') {
            servedBy = 'heuristic';
            break;
          }
          if (engine === 'foundation') {
            const fmResult = await deviceParseAccount(trimmed, {
              subtypeHint: accountIntent.subtypeHint,
            });
            if (fmResult) {
              extracted = fmResult;
              servedBy = engine;
              break;
            }
            continue;
          }
          // BYOK provider ('openai' | 'anthropic').
          const apiKey = await getByokKey(engine);
          if (!apiKey) continue;
          const modelId = await getByokModel(engine);
          const cloudCtx = {
            categories: cats,
            payees: pays,
            accounts: accts,
            now,
            accountSubtypeHint: accountIntent.subtypeHint,
          };
          const cloudResult =
            engine === 'openai'
              ? await openaiParse<AccountExtraction>(
                  trimmed,
                  cloudCtx,
                  apiKey,
                  modelId,
                  ACCOUNT_PARSE_CONTRACT
                )
              : await anthropicParse<AccountExtraction>(
                  trimmed,
                  cloudCtx,
                  apiKey,
                  modelId,
                  ACCOUNT_PARSE_CONTRACT
                );
          if (cloudResult) {
            extracted = cloudResult;
            servedBy = engine;
            break;
          }
        }

        const ready = buildReadyAccountFromChat(
          trimmed,
          extracted ?? { name: null, subtype: accountIntent.subtypeHint ?? 'unknown' }
        );
        setPendingAccount(ready);
        setAccountFlow(null);
        setReply(`"${ready.name}" — look right?`);
        showCard(accountCreateCard(ready, appCurrency));
        parseIdRef.current = await recordParse({
          engine: ACCOUNT_ENGINE_METRIC_LABEL[servedBy],
          outcome: 'confirm',
          inputLenBucket: inputLenBucket(trimmed.length),
          deviceAiCapable,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      if (accountIntent?.op === 'delete') {
        // Chat delete = RECOGNIZE + HANDOFF, NEVER execute (spec §5.3) — no
        // extraction call at all, purely deterministic: resolve the target,
        // compute the impact, hand off to manage-accounts. This code path
        // must NEVER call the hard-delete cascade primitive (see the
        // routing-level test, tests/__features__/account-delete-routing.feature).
        // `extractAccountReferenceFragment` strips the verb/determiners/
        // generic "account" noise so a full sentence ("delete my DBS
        // account") still resolves — findAccountMatch expects a reference
        // fragment, not a whole utterance (QA MAJOR follow-up).
        const match = findAccountMatch(extractAccountReferenceFragment(trimmed), accts);
        if (!match?.account) {
          setReply(accountDisambiguationPrompt(match));
          setLastOutcome('clarify');
          return;
        }
        const [txs, series] = await Promise.all([listTransactions(), listSeries()]);
        const impact = computeAccountDeleteImpact(match.account.id, txs, series);
        const handoff = buildAccountDeleteHandoff(match.account, impact, accts);
        setPendingAccount(null);
        setAccountFlow(null);
        setDeleteHandoff({
          accountId: match.account.id,
          accountName: match.account.name,
          deepLink: handoff.deepLink,
        });
        setReply(handoff.message);
        showCard(
          deleteHandoffCard({ accountId: match.account.id, accountName: match.account.name }, handoff.message)
        );
        parseIdRef.current = await recordParse({
          engine: 'floor',
          outcome: 'confirm',
          inputLenBucket: inputLenBucket(trimmed.length),
          deviceAiCapable,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      if (accountIntent?.op === 'update') {
        // Account-UPDATE gate hit (docs/design/account-chat-crud-spec.md §5.2)
        // — same engine order/shape as create, but the account contract's
        // target string is ALWAYS re-resolved through findAccountMatch against
        // the REAL account list (never trusted on its own), and the specific
        // sub-operation is classified deterministically first
        // (buildAccountUpdateDraft), the model only a tiebreak.
        let extracted: AccountUpdateDraftExtraction | null = null;
        let servedBy: EngineId = 'heuristic';
        for (const engine of engineOrder) {
          if (engine === 'heuristic') {
            servedBy = 'heuristic';
            break;
          }
          if (engine === 'foundation') {
            const fmResult = await deviceParseAccountUpdate(trimmed, {
              subtypeHint: accountIntent.subtypeHint,
            });
            if (fmResult) {
              extracted = fmResult;
              servedBy = engine;
              break;
            }
            continue;
          }
          const apiKey = await getByokKey(engine);
          if (!apiKey) continue;
          const modelId = await getByokModel(engine);
          const cloudCtx = {
            categories: cats,
            payees: pays,
            accounts: accts,
            now,
            accountSubtypeHint: accountIntent.subtypeHint,
          };
          const cloudResult =
            engine === 'openai'
              ? await openaiParse<AccountUpdateDraftExtraction>(
                  trimmed,
                  cloudCtx,
                  apiKey,
                  modelId,
                  ACCOUNT_UPDATE_PARSE_CONTRACT
                )
              : await anthropicParse<AccountUpdateDraftExtraction>(
                  trimmed,
                  cloudCtx,
                  apiKey,
                  modelId,
                  ACCOUNT_UPDATE_PARSE_CONTRACT
                );
          if (cloudResult) {
            extracted = cloudResult;
            servedBy = engine;
            break;
          }
        }

        // Same fragment-extraction fallback as the delete path — a model
        // targetName is the primary signal, but the deterministic-floor
        // case (no engine ran) must not feed a whole sentence to
        // findAccountMatch either.
        const match = findAccountMatch(
          extracted?.targetName ?? extractAccountReferenceFragment(trimmed),
          accts
        );
        if (!match?.account) {
          setReply(accountDisambiguationPrompt(match));
          setLastOutcome('clarify');
          return;
        }

        const draft = buildAccountUpdateDraft(trimmed, match.account, extracted);
        // An 'unknown' op means neither the deterministic classifier nor the
        // model could tell WHAT to change — a confirm card built from this
        // would write nothing (resolveUpdatedAccount keeps everything as-
        // is), so ask instead of showing a pointless no-op card (QA MINOR
        // follow-up).
        if (draft.op === 'unknown') {
          setReply(buildAccountUpdateClarifyMessage(match.account.name));
          setLastOutcome('clarify');
          return;
        }
        const updateDraft = { accountId: match.account.id, currentName: match.account.name, ...draft };
        setPendingAccountUpdate(updateDraft);
        setPendingAccount(null);
        setAccountFlow(null);
        setReply(accountUpdateConfirmMessage(match.account, draft, appCurrency));
        showCard(accountUpdateCard(updateDraft, appCurrency));
        parseIdRef.current = await recordParse({
          engine: ACCOUNT_ENGINE_METRIC_LABEL[servedBy],
          outcome: 'confirm',
          inputLenBucket: inputLenBucket(trimmed.length),
          deviceAiCapable,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      if (txOpCandidate) {
        // Chat transaction delete/update (docs/design/chat-transaction-
        // delete-update-spec.md §5.2) — the model emits ONE enum, never a
        // row. Same engine-order loop shape as account create/update above;
        // `heuristic` never calls a model at all here — it falls back to
        // the candidacy gate's own deterministic verb category (§5.2
        // "floor behaviour": safe because the PICKER, not the classifier,
        // protects the data), so this loop always ends with a concrete op.
        let op: 'delete' | 'update' | null = null;
        let servedBy: EngineId = 'heuristic';
        for (const engine of engineOrder) {
          if (engine === 'heuristic') {
            servedBy = 'heuristic';
            break;
          }
          if (engine === 'foundation') {
            const fmOp = await deviceParseTransactionOp(trimmed);
            if (fmOp) {
              op = fmOp;
              servedBy = engine;
              break;
            }
            continue;
          }
          // BYOK provider ('openai' | 'anthropic').
          const apiKey = await getByokKey(engine);
          if (!apiKey) continue;
          const modelId = await getByokModel(engine);
          const parseFn = engine === 'openai' ? openaiParse : anthropicParse;
          const cloudOp = await parseFn<'delete' | 'update'>(
            trimmed,
            { categories: cats, payees: pays, accounts: accts, now },
            apiKey,
            modelId,
            TRANSACTION_OP_PARSE_CONTRACT
          );
          if (cloudOp) {
            op = cloudOp;
            servedBy = engine;
            break;
          }
        }
        if (!op) op = txOpCandidate.verbCategory;

        // Deterministic pre-filter + ranking (spec §5.3/§5.4) — entirely
        // model-free; `op` above is the ONLY thing the model ever contributed.
        const txs = await listTransactions();
        const filterCtx: CandidateFilterContext = {
          payees: pays,
          accounts: accts,
          now,
          currency: appCurrency,
        };
        const filter = buildCandidateFilter(trimmed, filterCtx);
        const selection = selectCandidates(txs, filter);
        const nonArchivedAccounts = accts.filter((a) => !a.archived);
        const dataRevision = await getDataRevision();

        // Skip-the-account-step exception (spec §5.6): ask "which account?"
        // only when the ranked list is still oversized, the filter never
        // resolved an account, AND more than one non-archived account
        // exists — single-account users, and anyone who already named a
        // date/payee that narrowed it, never see this.
        const needsAccountChoice =
          selection.candidates.length > 5 &&
          filter.accountId == null &&
          nonArchivedAccounts.length > 1;

        setTxOp({
          op,
          filter,
          transactions: txs,
          candidates: selection.candidates,
          droppedConstraints: selection.droppedConstraints,
          dataRevision,
        });
        setTxOpNeedsAccountChoice(needsAccountChoice);
        setPendingAccount(null);
        setPendingAccountUpdate(null);
        setAccountFlow(null);
        setDeleteHandoff(null);
        setReply(
          needsAccountChoice
            ? `Found ${selection.candidates.length} matching transactions across more than one account — which account?`
            : txOpReplyMessage(op, selection.candidates, selection.droppedConstraints)
        );
        showCard(
          txPickerCard(
            { op, candidates: selection.candidates },
            { accounts: accts, categories: cats, payees: pays },
            appCurrency
          ),
          dataRevision
        );
        parseIdRef.current = await recordParse({
          engine: ENGINE_METRIC_LABEL[servedBy],
          outcome: selection.candidates.length === 0 ? 'clarify_missing' : 'confirm',
          intent: 'tx_op',
          inputLenBucket: inputLenBucket(trimmed.length),
          deviceAiCapable,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      // Budget wording the router did not read (budgetFallback): code gates
      // it, the model fills closed slots, code validates them. LAST before the
      // parse ladder - the query, account and transaction-op gates above all
      // return, so a question like "show me my food budget" or "delete coffee 5
      // from food budget" never reaches the model. `!queryIntent` etc. are
      // belt and braces for the same order src/domain/intentGate.ts encodes.
      if (!options?.forceExpense && !queryIntent && !accountIntent && !txOpCandidate) {
        const fallback = await budgetFallback(trimmed, cats, () => deviceParseBudget(trimmed, cats));
        if (fallback) {
          await budget.answerIntent(fallback, cats, pays, now);
          return;
        }
      }

      const ENGINE_RUNNERS: Record<EngineId, () => Promise<boolean>> = {
        openai: () => runCloudParse('openai'),
        anthropic: () => runCloudParse('anthropic'),
        foundation: runFmParse,
        heuristic: runHeuristicParse,
      };

      // Try each engine in the router's order, stopping at the first one
      // that produces a usable outcome (confirm OR clarify/blocked — anything
      // that already updated the UI); fall through on `false` (not capable,
      // no usable parse, or the engine itself failed). `heuristic` is always
      // last and essentially always returns true, so this loop's fallback
      // message below only fires in the same rare case it always did (the
      // heuristic's own output failing schema validation).
      const aiTried: string[] = [];
      for (const engine of engineOrder) {
        currentEngine = engine;
        if (engine === 'heuristic' && aiTried.length > 0) {
          heuristicAfterAi = true;
          setAiFallbackFrom(aiTried.join(' and '));
        }
        if (await ENGINE_RUNNERS[engine]()) return;
        if (engine !== 'heuristic') aiTried.push(AI_ENGINE_NAME[engine]);
      }

      setReply(
        'I couldn\'t parse that. Try "/transactions lunch 12.50", or add it manually below.'
      );
      setLastOutcome('error');
    } catch (e) {
      // Unexpected failure in the on-device parse path (FM session error,
      // local DB read, etc.) — surface it rather than leaving the user stuck.
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.warn('parse failed:', e);
      setReply(`Couldn't parse that — ${msg}`);
      setLastOutcome('error');
      // Label with whichever engine the loop above was actually attempting
      // when it threw (ENGINE_METRIC_LABEL maps 'foundation' -> 'on_device',
      // matching the label the successful path uses) — only fall back to
      // the old deviceAiCapable-based guess when the throw happened before
      // the loop even started (e.g. the initial listAccounts/isDeviceAiAvailable
      // reads), when there's no attempted engine to report.
      void recordParse({
        engine: currentEngine
          ? ENGINE_METRIC_LABEL[currentEngine]
          : deviceAiCapable
            ? 'on_device'
            : 'heuristic',
        outcome: 'error',
        inputLenBucket: inputLenBucket(trimmed.length),
        deviceAiCapable,
        latencyMs: Date.now() - startedAt,
      });
    } finally {
      setBusy(false);
    }
  }

  // "＋ New account" chip / typed "/account" both start the guided Q&A —
  // extracted so the two entry points can't drift apart.
  const startAccountCreation = () => {
    // The same reset every other entry point runs: clears every card flow (a
    // query answer, a draft, a picker...), the stale parse id and the log's
    // live card, so nothing is left beside the Q&A.
    resetActiveDraftState();
    const res = startAccountFlow();
    setAccountFlow(res.state);
    setReply(res.message);
  };

  // Advance the /account Q&A with `answer` — shared by the typed reply
  // (onSend, mid-flow) and the tap-don't-type subtype chips, so a chip and a
  // typed answer land on identical state via the same advanceAccountFlow call.
  const answerAccountFlow = (answer: string) => {
    if (!accountFlow) return;
    // A typed answer and a tapped chip are both the user's turn in the chat.
    chat.recordUser(answer);
    scrollFeedToNewest();
    const res = advanceAccountFlow(accountFlow, answer, appCurrency);
    setAccountFlow(res.state);
    setReply(res.message);
    if (res.ready) {
      setPendingAccount(res.ready);
      showCard(accountCreateCard(res.ready, appCurrency));
    }
  };

  const onSend = async () => {
    // Mirror the busy-guard the other action handlers have (onCreateAccount/
    // onConfirm/onEditSave) — a Send tapped while a prior action's async
    // window (e.g. onCreateAccount's loadContext) is still in flight would
    // otherwise race it. Guard before consuming `draft` so a no-op tap keeps
    // the text.
    if (busy) return;
    // Close the "+" menu if it is open: `showPlus` hides its anchor the
    // moment `busy` flips, so leaving it up would float a menu over the
    // greeting attached to a button that is no longer there.
    setPlusOpen(false);
    const text = draftRef.current;
    setDraft('');
    const t = text.trim();
    if (!t) return;

    // "/account" → start the guided account-creation Q&A.
    if (isAccountCommand(t)) {
      chat.recordUser(t);
      scrollFeedToNewest();
      startAccountCreation();
      return;
    }
    // Mid Q&A → treat this message as the answer to the current question
    // (answerAccountFlow records it as the user's turn).
    if (accountFlow) {
      answerAccountFlow(t);
      return;
    }
    // "/transactions [text]" → explicit expense trigger; parse the remainder.
    // forceExpense skips the account-intent gate entirely — the user
    // explicitly said "this is a transaction", so an account-noun-shaped
    // remainder ("/transactions open a savings account" is a weird thing to
    // type, but if they did, they meant it as an expense) must never be
    // reinterpreted as account creation. Plain (non-command) text below still
    // runs the gate normally.
    const txBody = transactionCommandBody(t);
    chat.recordUser(t);
    scrollFeedToNewest();
    if (txBody === '') {
      // §3.3 (stale-draft-spec.md) — this used to return before runParse and
      // therefore before resetActiveDraftState(), so a card left open from an
      // earlier message survived under this reply. Reset like any other
      // message: a bare "/transactions" is the user asking for a fresh one.
      resetActiveDraftState();
      setReply("Sure — what's the transaction?");
      return;
    }
    await runParse(txBody ?? text, txBody != null ? { forceExpense: true } : undefined);
  };

  // A tapped slash-menu row runs the command — whether the popover opened
  // from typing "/" or tapping "+" (§4.4: "any row tap" closes the latter).
  // "/account" needs no argument, so it goes straight through the same
  // startAccountCreation() the retired chip and the typed command used.
  // "/transactions" leaves a trailing space and keeps focus so the user
  // types the expense, matching onSend's empty-body reply.
  const runSlashCommand = (cmd: AssistantCommand) => {
    setPlusOpen(false);
    if (cmd.name === '/account') {
      setDraft('');
      startAccountCreation();
      return;
    }
    setDraft(`${cmd.name} `);
    inputRef.current?.focus();
  };

  // "What can I ask?" row in the same popover — clears the "/" draft (it was
  // never a real command) and opens the examples sheet instead of dispatching
  // anything. Tapping an example there just prefills + focuses the composer,
  // exactly like runSlashCommand's "/transactions" branch above; it never
  // sends on the user's behalf.
  const openExamplesSheet = () => {
    setPlusOpen(false);
    setDraft('');
    setExamplesSheetOpen(true);
  };

  const onPickExample = (text: string) => {
    setDraft(text);
    inputRef.current?.focus();
  };

  const onCreateAccount = async () => {
    if (!pendingAccount || busy) return;
    setBusy(true);
    try {
      await createAccount({
        id: `acc_${Date.now()}`,
        name: pendingAccount.name,
        subtype: pendingAccount.subtype,
        currency: appCurrency,
        openingBalance: pendingAccount.openingBalance,
      });
      const name = pendingAccount.name;
      resolveCard(ACCOUNT_CREATE_KINDS, accountCreateCard(pendingAccount, appCurrency));
      // Only meaningful for a chat one-shot gate hit (src/domain/parseMetrics.ts
      // — the /account Q&A never sets this); resolveParse no-ops on a null id.
      void resolveParse(parseIdRef.current, { resolved: 'saved' });
      parseIdRef.current = null;
      setPendingAccount(null);
      setAccountFlow(null);
      setReceipt(
        accountCreatedReceipt({
          name,
          subtype: pendingAccount.subtype,
          openingBalance: pendingAccount.openingBalance,
          currency: appCurrency,
        })
      );
      // Tag it so the receipt settles like every other one — without an
      // outcome the rule never fires and this line sat on screen for
      // minutes across unrelated taps.
      setLastOutcome('saved');
      await loadContext();
    } catch {
      setReply("I couldn't create that account — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onDiscardAccount = () => {
    void resolveParse(parseIdRef.current, { resolved: 'discarded' });
    parseIdRef.current = null;
    setPendingAccount(null);
    setAccountFlow(null);
    dismissCard(ACCOUNT_CREATE_KINDS, DISCARDED_TEXT);
    setReply(DISCARDED_TEXT, { record: false });
  };

  // Account UPDATE confirm/discard/edit (docs/design/account-chat-crud-spec.md
  // §5.2) — confirm-before-write, same discipline as create: `updateAccount`
  // only ever runs after the user taps Confirm on the (editable) card.
  const onConfirmAccountUpdate = async () => {
    if (!pendingAccountUpdate || busy) return;
    setBusy(true);
    try {
      const existing = accounts.find((a) => a.id === pendingAccountUpdate.accountId);
      if (!existing) throw new Error('account no longer exists');
      // `resolveUpdatedAccount` (src/domain/accountUpdateAssistant.ts) is the
      // write-time guardrail against the balance-corruption blocker (QA): a
      // rename/retype NEVER touches `openingBalance` unless the user
      // explicitly edited the balance field (`balanceEdited`).
      const write = resolveUpdatedAccount(existing, pendingAccountUpdate);
      await updateAccount({ ...existing, ...write });
      resolveCard(ACCOUNT_UPDATE_KINDS, accountUpdateCard(pendingAccountUpdate, appCurrency));
      void resolveParse(parseIdRef.current, { resolved: 'saved' });
      parseIdRef.current = null;
      setPendingAccountUpdate(null);
      setReply(
        accountUpdatedText({
          existing,
          next: {
            name: pendingAccountUpdate.newName,
            subtype: pendingAccountUpdate.newSubtype,
            balance: pendingAccountUpdate.newBalance,
            balanceEdited: pendingAccountUpdate.balanceEdited,
          },
        })
      );
      setLastOutcome('saved');
      await loadContext();
    } catch {
      setReply("I couldn't update that account — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onDiscardAccountUpdate = () => {
    void resolveParse(parseIdRef.current, { resolved: 'discarded' });
    parseIdRef.current = null;
    setPendingAccountUpdate(null);
    dismissCard(ACCOUNT_UPDATE_KINDS, ACCOUNT_UPDATE_CANCELLED_TEXT);
    setReply(ACCOUNT_UPDATE_CANCELLED_TEXT, { record: false });
  };

  const onChangeAccountUpdateName = (name: string) =>
    setPendingAccountUpdate((p) => (p ? { ...p, newName: name } : p));
  const onChangeAccountUpdateSubtype = (subtype: string) =>
    setPendingAccountUpdate((p) => (p ? { ...p, newSubtype: normalizeSubtype(subtype) } : p));
  // A manual edit to the balance field is ALWAYS an intentional change,
  // regardless of the classified op — marks `balanceEdited` so
  // `resolveUpdatedAccount` honors it even on a rename/retype.
  const onChangeAccountUpdateBalanceText = (text: string) =>
    setPendingAccountUpdate((p) =>
      p ? { ...p, newBalance: parseOpeningBalance(text), balanceEdited: true } : p
    );

  // Chat account DELETE handoff actions (spec §5.3) — "Open in Accounts"
  // deep-links to the ONLY screen that can actually delete; "Archive
  // instead" is the one-tap non-destructive alternative offered right here.
  // Neither of these — nor anything else reachable from this screen — ever
  // calls the hard-delete cascade primitive.
  const onOpenDeleteHandoffInAccounts = () => {
    if (!deleteHandoff) return;
    // `deleteHandoff.deepLink` (src/domain/accountDeleteHandoff.ts) is the
    // canonical, BDD-tested route string ("/manage-accounts?deleteAccountId=
    // ..."); expo-router's typed routes need the equivalent object form to
    // type-check a dynamically-built path, so this passes the SAME account
    // id through the typed `params` shape rather than the raw string.
    const accountId = deleteHandoff.accountId;
    resolveCard(DELETE_HANDOFF_KINDS);
    setDeleteHandoff(null);
    // The delete/archive itself happens over on manage-accounts.
    router.push({ pathname: '/manage-accounts', params: { deleteAccountId: accountId } });
  };

  const onArchiveFromDeleteHandoff = async () => {
    if (!deleteHandoff || busy) return;
    setBusy(true);
    try {
      const existing = accounts.find((a) => a.id === deleteHandoff.accountId);
      if (!existing) throw new Error('account no longer exists');
      await updateAccount({ ...existing, archived: true });
      resolveCard(DELETE_HANDOFF_KINDS);
      setReply(accountArchivedText(deleteHandoff.accountName));
      setLastOutcome('saved');
      setDeleteHandoff(null);
      await loadContext();
    } catch {
      setReply("I couldn't archive that account — please try again.");
    } finally {
      setBusy(false);
    }
  };

  // "Log anyway" after an FM refusal: heuristic parse of the same words, then
  // the normal draft/confirm flow.
  const onLogAnyway = async () => {
    if (!fmRefusal || busy) return;
    const refusedText = fmRefusal.text;
    setFmRefusal(null);
    // The user overrode the refusal: close its metric row as 'overridden' (the
    // false-refusal signal) before runParse starts the heuristic's own row.
    void resolveParse(parseIdRef.current, { resolved: 'overridden' });
    parseIdRef.current = null;
    await runParse(refusedText, { forceExpense: true, heuristicOnly: true });
  };

  const onDismissFmRefusal = () => {
    void resolveParse(parseIdRef.current, { resolved: 'discarded' });
    parseIdRef.current = null;
    setFmRefusal(null);
  };

  const onDismissDeleteHandoff = () => {
    dismissCard(DELETE_HANDOFF_KINDS);
    setDeleteHandoff(null);
  };

  // Clear the Ask-Xavier answer card. Until this existed, `queryAnswer` was
  // reset ONLY inside runParse's own reset block — so the single way to get rid
  // of an answer was to ask something else, and a card sat there for the rest
  // of the session (including across tab switches).
  const onDismissQueryAnswer = () => {
    // Not a discard: the answer stays in the log as read-only history.
    dismissCard(QUERY_KINDS);
    setQueryAnswer(null);
  };

  // Chat transaction delete/update actions (docs/design/chat-transaction-
  // delete-update-spec.md §5.5/§5.6) — the model never picks a row; these
  // handlers ONLY run once the user has tapped an actual row. Delete reuses
  // `deleteTransaction` (the ledger's own primitive, exactly one OTHER call
  // site — see tests/__features__/transaction-op-routing.feature); update
  // opens `TransactionFormSheet` in edit mode — no bespoke write path.
  const onChooseTxOpAccount = (account: Account) => {
    if (!txOp) return;
    const filter: TransactionCandidateFilter = { ...txOp.filter, accountId: account.id };
    const selection = selectCandidates(txOp.transactions, filter);
    setTxOp({
      ...txOp,
      filter,
      candidates: selection.candidates,
      droppedConstraints: selection.droppedConstraints,
    });
    setTxOpNeedsAccountChoice(false);
    const pickerId = chat.liveCardId(TX_PICKER_KINDS);
    if (pickerId) {
      chat.updateCard(
        pickerId,
        txPickerCard({ op: txOp.op, candidates: selection.candidates }, { accounts, categories, payees }, appCurrency)
      );
    }
    // The candidate SET just changed (narrowed by account) — any multi-
    // select ticks would be against stale rows. Belt-and-braces: this step
    // always runs before the picker itself has ever rendered, so nothing
    // could actually be ticked yet, but clearing keeps the invariant
    // "txOpSelectedIds only ever reflects the CURRENT txOp.candidates" true
    // regardless.
    setTxOpSelectedIds(new Set());
    setReply(txOpReplyMessage(txOp.op, selection.candidates, selection.droppedConstraints));
  };

  const onDismissTxOp = () => {
    dismissCard(TX_PICKER_KINDS);
    setTxOp(null);
    setTxOpNeedsAccountChoice(false);
    setTxOpSelectedIds(new Set());
  };

  // Dismissing the "which account?" step (without picking one) does NOT
  // abandon the tx-op flow the way onDismissTxOp above does — `txOp` stays
  // set, so the normal candidate list (TransactionOpPicker) reappears
  // underneath it (same `txOp && !txOpNeedsAccountChoice` render gate this
  // step exists to skip past). So the reply must switch back to describing
  // THAT list — the same message its own opening reply would have used —
  // rather than linger on the now-dismissed "which account?" question.
  const onDismissTxOpAccountChoice = () => {
    setTxOpNeedsAccountChoice(false);
    if (!txOp) return;
    setReply(txOpReplyMessage(txOp.op, txOp.candidates, txOp.droppedConstraints));
  };

  // A tapped candidate row (from the confirm card, the inline list, or the
  // "Show all N" sheet) — same handler regardless of picker size, so every
  // size satisfies "no write until an explicit tap" (spec §7 acceptance #9)
  // identically.
  const onPickTxOpCandidate = async (tx: Transaction) => {
    if (!txOp || busy) return;
    setBusy(true);
    try {
      const fresh = await reReadTxOpCandidate(tx);
      if (!fresh) {
        expireCard(TX_PICKER_KINDS);
        setTxOp(null);
        setTxOpNeedsAccountChoice(false);
        setTxOpShowAllOpen(false);
        setTxOpSelectedIds(new Set());
        setReply("That transaction changed or was already removed — send your request again for an updated list.");
        setLastOutcome('clarify');
        return;
      }
      if (txOp.op === 'delete') {
        const { title, body } = txOpDeleteConfirmCopy(fresh, accountsById);
        setTxOpShowAllOpen(false);
        Alert.alert(title, body, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setBusy(true);
              try {
                await deleteTransaction(fresh.id);
                resolveCard(TX_PICKER_KINDS);
                const counterparty =
                  fresh.type === 'transfer' && fresh.transferAccountId
                    ? accountsById.get(fresh.transferAccountId)?.name
                    : undefined;
                setTxOp(null);
                setTxOpNeedsAccountChoice(false);
                setTxOpSelectedIds(new Set());
                setReply(deletedText(counterparty));
                setLastOutcome('saved');
                await loadContext();
              } finally {
                setBusy(false);
              }
            },
          },
        ]);
      } else {
        // The picker stays live in the log until the edit is saved (or abandoned).
        setTxOpUpdateEditing(fresh);
        setTxOpEditorError(null);
        setTxOp(null);
        setTxOpNeedsAccountChoice(false);
        setTxOpShowAllOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  // Multi-select delete (docs/design/chat-transaction-delete-update-spec.md
  // §13 amendment) — DELETE ONLY; the update flow never calls either of
  // these (it stays single-pick via onPickTxOpCandidate above, unchanged).
  // Ticking a row never writes anything by itself — only
  // onDeleteSelectedTxOp, after an explicit tap on the count-labelled
  // primary action AND the native destructive confirm, ever does.
  const onToggleTxOpCandidate = (id: string) => {
    setTxOpSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Deletes every ticked row as ONE atomic batch (`deleteTransactions`,
  // src/features/transactions/repository.ts — see its header for why a loop
  // of single deletes can't guarantee all-or-nothing). The stale-row guard
  // (spec §5.5/§9.5) applies to EVERY selected row, not just one: any
  // mismatch aborts the WHOLE batch with no write at all, never a partial
  // delete of just the still-valid rows.
  const onDeleteSelectedTxOp = async () => {
    if (!txOp || busy || txOpSelectedIds.size === 0) return;
    const picked = txOp.candidates.filter((tx) => txOpSelectedIds.has(tx.id));
    if (picked.length === 0) return;
    setBusy(true);
    try {
      const reRead = await Promise.all(picked.map((tx) => reReadTxOpCandidate(tx)));
      if (reRead.some((tx) => tx === null)) {
        expireCard(TX_PICKER_KINDS);
        setTxOp(null);
        setTxOpNeedsAccountChoice(false);
        setTxOpShowAllOpen(false);
        setTxOpSelectedIds(new Set());
        setReply(
          'Some of those changed or were already removed — send your request again for an updated list.'
        );
        setLastOutcome('clarify');
        return;
      }
      const fresh = reRead as Transaction[];

      const summary = summarizeTransactionSelection(fresh, accounts);
      const { title, body } = txOpBatchDeleteConfirmCopy(summary, appCurrency);
      setTxOpShowAllOpen(false);
      Alert.alert(title, body, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete ${fresh.length}`,
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteTransactions(fresh.map((tx) => tx.id));
              resolveCard(TX_PICKER_KINDS);
              setTxOp(null);
              setTxOpNeedsAccountChoice(false);
              setTxOpSelectedIds(new Set());
              setReply(deletedManyText(fresh.length, summary.transferCounterpartyNames));
              setLastOutcome('saved');
              await loadContext();
            } finally {
              setBusy(false);
            }
          },
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onCloseTxOpUpdateEditor = () => {
    // The edit was walked away from: the picker stubs as "nothing changed".
    dismissCard(TX_PICKER_KINDS);
    setTxOpUpdateEditing(null);
    setTxOpEditorError(null);
    // `txOp` itself is already null by this point (onPickTxOpCandidate
    // clears it before opening this editor).
  };

  // Mirrors app/(tabs)/transactions.tsx's own onSave for the edit path
  // exactly — findOrCreate the category/payee, write via `updateTransaction`
  // (the existing primitive, unchanged). Re-verifies the stale-row guard
  // immediately before writing too, since the sheet can stay open a while.
  const onTxOpUpdateSave = async (values: FormValues) => {
    if (!txOpUpdateEditing || busy) return;
    const isTransfer = values.type === 'transfer';
    if (isTransfer && !values.transferAccountId) {
      setTxOpEditorError('Choose where the transfer goes.');
      return;
    }
    setBusy(true);
    try {
      const fresh = await reReadTxOpCandidate(txOpUpdateEditing);
      if (!fresh) {
        expireCard(TX_PICKER_KINDS);
        setTxOpUpdateEditing(null);
        setReply('That transaction changed or was already removed — please try again.');
        setLastOutcome('clarify');
        return;
      }

      const categoryName = values.categoryName.trim();
      const payeeName = values.payeeName.trim();
      const explicitCategoryId = categoryName
        ? await findOrCreateCategory(categoryName, values.type)
        : null;

      let payeeId: string | null = null;
      let categoryId = explicitCategoryId;
      if (payeeName) {
        const existing = await getPayeeByName(payeeName);
        categoryId = resolveCategoryId(explicitCategoryId, existing);
        payeeId = existing ? existing.id : await findOrCreatePayee(payeeName, categoryId);
      }

      const updated: Transaction = {
        ...fresh,
        accountId: values.accountId,
        type: values.type,
        amount: values.amountMinor,
        categoryId,
        payeeId,
        transferAccountId: isTransfer ? values.transferAccountId || null : null,
        note: values.note.trim() || null,
        occurredAt: values.date,
        pending: values.pending,
      };
      await updateTransaction(updated);
      resolveCard(TX_PICKER_KINDS);
      setTxOpUpdateEditing(null);
      setTxOpEditorError(null);
      setReceipt(
        updatedReceiptFor({
          tx: updated,
          payeeName: payeeName || null,
          categoryName: categoryName || null,
          categories,
          accounts,
          now: Date.now(),
        })
      );
      setLastOutcome('saved');
      await loadContext();
    } catch {
      setTxOpEditorError('Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Confirm-card edits (docs/design/account-chat-creation-spec.md §5.4 point
  // 5/§8 acceptance #6) — name/subtype/balance are all editable before
  // Create; each handler updates the SAME `pendingAccount` state
  // `onCreateAccount` persists, so an edit is exactly what gets saved.
  const onChangeAccountName = (name: string) =>
    setPendingAccount((p) => (p ? { ...p, name } : p));
  const onChangeAccountSubtype = (subtype: string) =>
    setPendingAccount((p) => (p ? { ...p, subtype: normalizeSubtype(subtype) } : p));
  // The field carries free text ("500", "$1,250.50", "owe 200") — the same
  // deterministic reader the chat one-shot's own balance comes from
  // (parseOpeningBalance), never trusting the raw text itself as the value.
  const onChangeAccountBalanceText = (text: string) =>
    setPendingAccount((p) => (p ? { ...p, openingBalance: parseOpeningBalance(text) } : p));

  const onConfirm = async () => {
    if (!pending || busy) return;
    if (pending.mismatchedCurrency) {
      // Never save a foreign-currency amount as-is (CLAUDE.md #3 — ask,
      // never convert): route straight to the same card's Edit sheet so the
      // user re-enters the amount in the account's own currency instead.
      setEditorOpen(true);
      return;
    }
    setBusy(true);
    const pendingType = pending.type;
    try {
      // Never a series on this path (no form, so no repeat rule), but the
      // return type is now nullable — normalise for resolveParse's optional id.
      const txId = await saveAssistantDraft(pending);
      void resolveParse(parseIdRef.current, {
        resolved: 'saved',
        txId: txId ?? undefined,
        payeeSwapped: payeeSwappedRef.current,
      });
      parseIdRef.current = null;
      if (queue) {
        // Mid-queue: advance to the next card (or the end summary) instead
        // of the one-off save receipt — see
        // advanceQueueOrFinish. Awaited (QA MINOR 11) so `busy` (still true
        // here) covers the new card's own recordLayoutParse too.
        chat.recordXavier(queueRowReceipt(pending, accounts, Date.now()), { logged: true });
        await advanceQueueOrFinish(decideCurrent(queue, 'saved'));
      } else {
        const savedDraft = pending;
        resolveCard(DRAFT_KINDS, draftCard(savedDraft, accounts));
        setPending(null);
        setSuggestion(null);
        setCategorySuggestion(null);
        setParseSource(null);
        // A placeholder until the receipt lands; the chat log records the final one.
        setReply(SAVED_FALLBACK, { record: false });
        const stamp = replyStampRef.current;
        await budget.showSavedReceipt(savedDraft, txId, null, () =>
          shouldApplyReceipt(stamp, replyStampRef.current)
        );
      }
      // The reaction settles on its own (the `replySettleRule` effect); the
      // receipt itself stays in the feed.
      setLastOutcome(pendingType === 'expense' ? 'spent' : 'saved');
      await loadContext();
    } catch (e) {
      // Write-boundary refusal (stale-draft-spec.md §3.1) — saveAssistantDraft
      // re-checks the account/currency against the live DB at save time and
      // throws rather than write; the loadContext focus-check above usually
      // catches this first (see explainStaleDraft), but a race that reaches
      // Save anyway still gets the same explanation, never a silent no-op.
      if (e instanceof DraftAccountGoneError) {
        await explainStaleDraft('account-gone');
      } else if (e instanceof DraftTransferAccountGoneError) {
        await explainStaleDraft('transfer-account-gone');
      } else if (e instanceof DraftCurrencyStaleError) {
        await explainStaleDraft('currency-changed');
      } else {
        setReply("I couldn't save that — please try again.");
        setLastOutcome('error');
      }
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = async () => {
    if (busy) return;
    void resolveParse(parseIdRef.current, { resolved: 'discarded' });
    parseIdRef.current = null;
    if (queue) {
      // Mid-queue this is "Skip" (see DraftCard's discardLabel prop) —
      // advance to the next card instead of clearing back to idle. `busy`
      // held across the await for the same double-tap reason as onConfirm
      // (QA MINOR 11).
      setBusy(true);
      try {
        await advanceQueueOrFinish(decideCurrent(queue, 'skipped'));
      } finally {
        setBusy(false);
      }
      return;
    }
    setPending(null);
    setSuggestion(null);
    setCategorySuggestion(null);
    setParseSource(null);
    setLastOutcome(null);
    dismissCard(DRAFT_KINDS, DISCARDED_TEXT);
    setReply(DISCARDED_TEXT, { record: false });
  };

  // "Use Starbucks" — adopt the existing payee's name so the save path matches
  // it exactly (and inherits its learned default category).
  const onUseSuggestion = () => {
    if (!suggestion) return;
    payeeSwappedRef.current = true;
    setPending((p) => (p ? { ...p, payeeName: suggestion.name } : p));
    setSuggestion(null);
  };

  // "Keep what I typed" — dismiss the hint; the new payee is created on save.
  const onKeepPayee = () => setSuggestion(null);

  // "Use Travel" — adopt the existing category's name so the save path
  // matches it exactly instead of creating a near-duplicate.
  const onUseCategorySuggestion = () => {
    if (!categorySuggestion) return;
    setPending((p) => (p ? { ...p, categoryName: categorySuggestion.name } : p));
    setCategorySuggestion(null);
  };

  // "Keep what I typed" — dismiss the hint; the new category is created on save.
  const onKeepCategory = () => setCategorySuggestion(null);

  // "Use SG Pools" — move the draft onto the account the user probably meant.
  // Not a plain accountId swap: acceptAccountSuggestion (domain/assistant.ts)
  // also takes that account's currency and its own currency-conflict result,
  // which interpret() computed against the currency the user typed.
  const onUseAccountSuggestion = () => setPending((p) => (p ? acceptAccountSuggestion(p) : p));

  // "Keep UOB One" — dismiss the hint; the draft stays on its account.
  const onKeepAccount = () => setPending((p) => (p ? dismissAccountSuggestion(p) : p));

  // "Use Food instead" — the user prefers the engine's proposal over the
  // category this payee remembered (domain/learnedDefaults.ts). The
  // proposal gets the same "did you mean…?" reconcile it would have had,
  // and saving then teaches the payee the proposal (last confirmed wins).
  const onRevertLearnedCategory = () => {
    if (!pending?.learnedCategory) return;
    const reverted = revertLearnedCategory(pending);
    setPending(reverted);
    const { suggestion: nearCat } = reverted.categoryName
      ? findCategoryMatch(reverted.categoryName, reverted.type, categories)
      : { suggestion: undefined };
    setCategorySuggestion(nearCat ?? null);
  };

  // "Use Wallet instead" — back onto the account the engine/default chose,
  // with the currency conflict (if any) it had then.
  const onRevertLearnedAccount = () => setPending((p) => (p ? revertLearnedAccount(p) : p));

  const onEdit = () => setEditorOpen(true);

  // "This parse was wrong" — the editor is where the fix happens, so open it
  // with the report flag set; onEditSave writes the correction once the
  // corrected draft is actually saved (a discarded fix teaches nothing).
  const onReportWrong = () => {
    setReportWrong(true);
    setEditorOpen(true);
  };

  // The primary Save path now handles transfers (TransactionDraft carries a
  // transferAccountId), and TransactionFormSheet already has a "To account"
  // picker for the transfer type, so editing into/within a transfer rides
  // along here too — resolved from the sheet's own FormValues.transferAccountId.
  const onEditSave = async (values: FormValues) => {
    if (!pending || busy) return;
    const isTransfer = values.type === 'transfer';
    // Same guard as the transactions/account screens (app/(tabs)/transactions.tsx,
    // app/account/[id].tsx) — don't attempt the save, and don't let zod's
    // generic rejection surface as "Could not save.".
    if (isTransfer && !values.transferAccountId) {
      setEditorError('Choose where the transfer goes.');
      return;
    }
    setBusy(true);
    try {
      const edited: TransactionDraft = {
        accountId: values.accountId,
        type: values.type,
        amount: values.amountMinor,
        currency: pending.currency,
        categoryName: isTransfer ? null : values.categoryName.trim() || null,
        payeeName: isTransfer ? null : values.payeeName.trim() || null,
        note: values.note.trim() || null,
        occurredAt: values.date,
        source: 'ai',
        sourceText: pending.sourceText ?? null,
        transferAccountId: isTransfer ? values.transferAccountId || null : null,
        transferAccountName: isTransfer
          ? (accounts.find((a) => a.id === values.transferAccountId)?.name ?? null)
          : null,
        // The user just confirmed every field in the editor — nothing left to guess.
        defaulted: { account: false, payee: false, category: false, date: false },
        pending: values.pending,
      };
      // A back-dated repeat is ambiguous and must not be answered silently in
      // either direction: creating every intervening charge is how one entry
      // became thirteen rows, and creating none hides charges the user
      // believes are recorded. Only asked when the start date is genuinely
      // behind us. Cancelling resolves false — a missing row can be added, a
      // wrong one has to be hunted down.
      //
      // backfillOccurrences EXCLUDES the anchor, which is right here: the
      // anchor is the transaction being confirmed, and saveAssistantDraft
      // writes it directly either way. So the number in the prompt is the
      // number of NEW rows.
      let backfill = false;
      if (values.repeatRule) {
        const missed = backfillOccurrences(values.repeatRule, values.date, Date.now());
        if (missed.length > 0) {
          backfill = await new Promise<boolean>((resolve) => {
            Alert.alert(
              'Add the earlier charges?',
              'This starts before today. Add the charges that have already come due, or start from the date you entered?',
              [
                { text: 'Just this one', onPress: () => resolve(false) },
                { text: 'Add them', onPress: () => resolve(true) },
              ],
              { cancelable: true, onDismiss: () => resolve(false) }
            );
          });
        }
      }
      // A repeat rule turns this into a series; saveAssistantDraft then
      // returns null, and resolveParse's txId is optional for that case.
      const txId = await saveAssistantDraft(edited, values.repeatRule, backfill);
      void resolveParse(parseIdRef.current, {
        resolved: 'edited',
        txId: txId ?? undefined,
        payeeSwapped: payeeSwappedRef.current,
      });
      parseIdRef.current = null;
      if (reportWrong && edited.sourceText) {
        // The saved fields ARE the correction. Grounding is what the engine
        // saw (this screen's current lists); the clock is the parse's own.
        void recordCorrection({
          text: edited.sourceText,
          categories,
          payeeNames: payees.map((p) => p.name),
          accounts,
          now: parseNowRef.current,
          corrected: {
            amountMinor: edited.amount,
            type: edited.type,
            occurredAt: edited.occurredAt,
            categoryName: edited.categoryName,
            payeeName: edited.payeeName,
          },
          engine: parseSource,
        });
      }
      setReportWrong(false);
      setEditorOpen(false);
      if (queue) {
        // An Edit-then-Save mid-queue still counts as this card's decision
        // ("saved" — resolveParse above already recorded it as 'edited').
        // Awaited for the same double-tap reason as onConfirm (QA MINOR 11).
        chat.recordXavier(queueRowReceipt(edited, accounts, Date.now()), { logged: true });
        await advanceQueueOrFinish(decideCurrent(queue, 'saved'));
      } else {
        resolveCard(DRAFT_KINDS, draftCard(edited, accounts));
        setPending(null);
        setSuggestion(null);
        setCategorySuggestion(null);
        setParseSource(null);
        // A placeholder until the receipt lands; the chat log records the final one.
        setReply(SAVED_FALLBACK, { record: false });
        const stamp = replyStampRef.current;
        await budget.showSavedReceipt(edited, txId, values.repeatRule, () =>
          shouldApplyReceipt(stamp, replyStampRef.current)
        );
      }
      setLastOutcome(values.type === 'expense' ? 'spent' : 'saved');
      await loadContext();
    } catch (e) {
      // Same write-boundary refusal as onConfirm (stale-draft-spec.md §3.1):
      // an in-sheet error message would just invite retrying the same
      // now-invalid save, so this closes the sheet and explains in chat
      // instead of leaving the user stuck editing a card that can't be
      // saved no matter what they change.
      if (e instanceof DraftAccountGoneError) {
        await explainStaleDraft('account-gone');
      } else if (e instanceof DraftTransferAccountGoneError) {
        await explainStaleDraft('transfer-account-gone');
      } else if (e instanceof DraftCurrencyStaleError) {
        await explainStaleDraft('currency-changed');
      } else {
        setEditorError('Could not save. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  // One entry point for every photo, camera or library (docs/design/
  // unified-scan-spec.md §4.2, folding statement-scan-spec.md §4.4/§4.5
  // together): on-device layout reconstruction always runs first, and the
  // number of amount rows it finds — via chooseScanRoute — decides what
  // happens next. Two or more rows fan out into the statement review queue;
  // a receipt (however many item lines) or a 0–1-row layout stays ONE
  // transaction through the same text parse the old single-receipt path
  // used. onCameraTap/onScanDeepLink's own `busy` guards cover the menu;
  // this function's own guard covers the async gap between picking the
  // photo and finishing.
  //
  // Review M1: no up-front resetActiveDraftState() here — an unreadable/
  // empty/too-many photo must leave whatever card the user already had on
  // screen alone. The single branch needs none of its own either (runParse
  // resets state itself, right before it builds the new draft); only the
  // queue branch resets, and only once it's actually committed to handing
  // off to beginStatementQueue/the account picker.
  const scanImage = async (asset: { uri: string; width: number; height: number }) => {
    if (busy) return;
    setBusy(true);
    const startedAt = Date.now();
    try {
      let observations;
      try {
        observations = await getRecognizer().recognizeLayout(asset.uri);
      } catch {
        // The user did send a photo, even if it could not be read: the label only.
        chat.recordPhoto(PHOTO_LABELS.unreadable);
        scrollFeedToNewest();
        setReply("I couldn't read that photo — try a clearer shot.");
        return;
      }
      const layout = reconstructLayout(observations);
      // QA MINOR 10: the real recognise+reconstruct cost, for the first
      // card's own recordLayoutParse call (see beginStatementQueue) —
      // measured here since this is the only place either step runs.
      statementScanLatencyRef.current = Date.now() - startedAt;
      const route = chooseScanRoute(layout);
      // Recorded as soon as the kind of photo is known, even if it then fails.
      chat.recordPhoto(route.kind === 'single' ? PHOTO_LABELS.receipt : PHOTO_LABELS.statement);
      scrollFeedToNewest();

      if (route.kind === 'too_many') {
        setReply(
          `That's ${route.rowCount} rows — I can take ${MAX_STATEMENT_ROWS} at a time. Try it in two shots.`
        );
        return;
      }

      if (route.kind === 'single') {
        // The single-transaction text path (statement-scan-spec §4.5 / QA
        // MINOR 12): one classifyOcrText step, then runParse, then the
        // layout's own amount — a receipt TOTAL line, or (review B1) the
        // layout's own single fully-read row when there's no total —
        // overrides whatever runParse guessed, via applyLayoutAmount.
        const outcome = classifyOcrText(layout.text);
        if (outcome.kind === 'empty') {
          setReply("I couldn't find any text in that photo — try a clearer shot.");
          return;
        }
        // forceExpense, because a PHOTO already carries the user's intent:
        // they pointed a camera at a receipt to RECORD it. The words printed
        // on the paper are data, not instructions — and runParse's three
        // gates (query, account, tx_op) read free text as instructions. A
        // receipt speaks fluent ledger: "Change  0.00" is an UPDATE verb and
        // "SERVICE CHARGE 10%" is a ledger noun, so together they satisfy the
        // tx_op gate's verb+reference requirement and a Sanook Kitchen
        // receipt opened the "which transaction do you want to update?"
        // picker instead of a card (user report, build 95). Neither line
        // trips the gate alone. This is not a vocabulary gap to patch —
        // no wordlist survives arbitrary receipt copy — so the scan path
        // takes the same bypass "/transactions <text>" already uses.
        await runParse(outcome.text, { forceExpense: true });
        // runParse's own resetActiveDraftState() (its first line) already
        // cleared any earlier scanSource — set THIS photo's only now, once
        // the new draft is actually about to render, so a failure branch
        // above (which returns without touching `pending`) can never leave
        // an old card on screen paired with a new, unrelated photo (row-
        // snippet-spec.md §4.3/§4.4).
        setScanSource(asset);
        // The scan path never carries an unmatchedAccountName warning
        // (statementDrafts.ts's forgetUnmatchedAccount, user report build
        // 97): interpret() can set it from a card network or other stray
        // printed word ("VISA") that the USER never typed, and the card
        // would otherwise invite creating a phantom account for it. A
        // successful match (e.g. a receipt's "OCBC" resolving to the
        // user's real OCBC account) is untouched — only the warning goes.
        setPending((p) => (p ? forgetUnmatchedAccount(applyLayoutAmount(p, layout)) : p));
        return;
      }

      // route.kind === 'queue'
      const activeAccounts = accounts.filter((a) => !a.archived);
      if (activeAccounts.length === 0) {
        setReply('Add an account first, then try that photo again.');
        return;
      }
      // Only now is a queue actually starting — the new photo owns the
      // screen from here (review M1). Same reasoning as the 'single' branch
      // above: scanSource is set right where resetActiveDraftState() just
      // ran, never earlier, so a failure return above this point can't pair
      // an old card with this new photo.
      resetActiveDraftState();
      setScanSource(asset);
      if (activeAccounts.length === 1) {
        await beginStatementQueue(layout, activeAccounts[0]!);
      } else {
        // "Which account is this from?" — pre-selected from the header text
        // when findAccountMatch resolves it unambiguously (docs/design/
        // statement-scan-spec.md §4.4 point 4); the sheet itself supplies
        // that pre-selection at render time (see statementAccountPreselectId
        // below).
        setStatementAccountChoice(layout);
      }
    } catch {
      setReply("I couldn't read that photo — try a clearer shot.");
    } finally {
      setBusy(false);
    }
  };

  const capturePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setReply('I need camera access to take a photo.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;
    const asset = shot.assets[0];
    await scanImage({ uri: asset.uri, width: asset.width, height: asset.height });
  };

  const pickPhoto = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    const asset = picked.assets[0];
    await scanImage({ uri: asset.uri, width: asset.width, height: asset.height });
  };

  // Recompute the payee/category "did you mean…?" chips for `draft`, same
  // reconciliation runFmParse/runHeuristicParse do for a fresh chat draft,
  // except the payee net is findStatementPayeeMatch (not findPayeeMatch) —
  // this is the statement-queue card path only, where a payee's normalised
  // name being a whole-word prefix of the cleaned description ("Kopitiam" in
  // "Kopitiam Investment") is a real suggestion signal that typed-input chat
  // drafts don't need. Reused here so each card in the queue gets its own.
  const reconcileSuggestionsFor = (draft: TransactionDraft) => {
    if (draft.payeeName) {
      const { suggestion: near } = findStatementPayeeMatch(draft.payeeName, payees);
      setSuggestion(near ?? null);
    } else {
      setSuggestion(null);
    }
    if (draft.categoryName) {
      const { suggestion: nearCat } = findCategoryMatch(draft.categoryName, draft.type, categories);
      setCategorySuggestion(nearCat ?? null);
    } else {
      setCategorySuggestion(null);
    }
  };

  // One recordParse per drafted row (docs/design/statement-scan-spec.md
  // §4.4 point 6) — `engine: 'layout'`, so the diagnostics export can report
  // accept/edit rates for the statement path like every other engine.
  // `latencyMs` defaults to 0 (every card after the first — nothing async
  // happens between cards); the FIRST card's own call passes the real
  // recognise+reconstruct time (QA MINOR 10) — see beginStatementQueue.
  const recordLayoutParse = async (latencyMs = 0) => {
    parseIdRef.current = await recordParse({
      engine: 'layout',
      outcome: 'confirm',
      deviceAiCapable: false,
      latencyMs,
    });
  };

  // Advance `queue` to its next card, or — once every draft has been decided
  // — close it out with the honest end summary (spec §4.4 point 5) and
  // return to the idle state.
  //
  // Async, and callers AWAIT it (QA MINOR 11): `recordLayoutParse` sets
  // `parseIdRef.current` for the NEW card, and until that resolves, a fast
  // double-decision (Save then immediately Save/Skip again) could otherwise
  // resolve the wrong metric row — attaching card N's outcome to card N+1's
  // parse id. Every caller keeps `busy` true across this await (their own
  // `if (busy) return` guard is what actually blocks the double-tap).
  //
  // Bails on a stale advance (QA MAJOR 4): Save on card N starts an async
  // save; if "Stop reviewing" (or another decision) finishes FIRST and nulls
  // the queue, this call's own `q` was computed from a now-stale snapshot —
  // applying it directly would resurrect an already-ended queue. The check
  // reads `queueRef` (see its declaration for why not a setState updater)
  // and, when the CURRENT queue is already null, bails without touching
  // reply/pending/suggestions either. The busy guard + disabled Stop
  // pressable close the window in practice; this is the backstop.
  const advanceQueueOrFinish = async (q: DraftQueue) => {
    if (!queueRef.current) return;
    setQueue(queueDone(q) ? null : q);
    // Reset for the NEXT card/decision (QA MAJOR 2) — otherwise "Use
    // Kopitiam" on card 1 leaves every LATER card's resolveParse recording
    // payeeSwapped: true even though nothing was swapped on them.
    payeeSwappedRef.current = false;

    if (queueDone(q)) {
      // Pure end-summary sentence (QA MINOR 5) — see statementSummary
      // (src/domain/draftQueue.ts) for the "couldn't be read" wording,
      // which also covers table rows dropped for having TWO amounts, not
      // none (QA MAJOR 1).
      setReply(statementSummary(q, statementDroppedRef.current));
      // Finished, or stopped midway: either way the queue collapses to its summary.
      resolveCard(DRAFT_KINDS, statementQueueCard(q, accounts));
      setPending(null);
      setSuggestion(null);
      setCategorySuggestion(null);
      setParseSource(null);
      // The queue is done, so no card (and so no RowSnippet) is showing —
      // clear the photo here too, not just in resetActiveDraftState(), so
      // state matches the "disappears on save/skip" contract (row-snippet-
      // spec.md D1) rather than lingering until the next scan/message.
      setScanSource(null);
      statementDroppedRef.current = 0;
      return;
    }
    const next = currentDraft(q)!;
    setPending(next);
    setParseSource('layout');
    reconcileSuggestionsFor(next);
    const queueId = chat.liveCardId(STATEMENT_QUEUE_KINDS);
    if (queueId) chat.updateCard(queueId, statementQueueCard(q, accounts));
    // reviewProgress's label counts the card being shown ("2 of 6"), not
    // how many are already decided — see draftQueue.ts (QA MINOR 6). It is a
    // progress marker, not something Xavier said, so the chat log skips it.
    setReply(reviewProgress(q).label, { record: false });
    await recordLayoutParse();
  };

  // "Stop reviewing" (spec §4.4 point 5) — every remaining card becomes
  // skipped in one step; queueSummary still counts them. Guarded on `busy`
  // (QA MAJOR 4) and itself holds `busy` across the advance — otherwise an
  // in-flight Save's own advanceQueueOrFinish could race this one (see that
  // function's own comment) and the Stop pressable, which is disabled while
  // busy (see its `disabled` prop below), would still have been tappable in
  // the gap before the first render reflecting `busy: true` landed.
  const onStopReviewingQueue = async () => {
    if (!queue || busy) return;
    void resolveParse(parseIdRef.current, { resolved: 'discarded' });
    parseIdRef.current = null;
    setBusy(true);
    try {
      await advanceQueueOrFinish(stopReviewing(queue));
    } finally {
      setBusy(false);
    }
  };

  // rowsToDrafts → startQueue, then show the first card exactly like a fresh
  // chat draft (source pill, payee/category suggestion, metric row).
  const beginStatementQueue = async (layout: StatementLayout, account: Account) => {
    setBusy(true);
    try {
      const existingTx = await listTransactions();
      // Same active-account list the picker itself offers (QA MINOR 7) — an
      // archived account was previously still a candidate transfer
      // destination via the raw `accounts` state.
      const activeAccounts = accounts.filter((a) => !a.archived);
      const { drafts, dropped } = rowsToDrafts(layout, {
        account,
        accounts: activeAccounts,
        payees,
        categories,
        existing: existingTx,
        now: Date.now(),
      });
      // Multi-amount rows never reach `layout.rows` at all — the domain's
      // own `dropped` (zero-value rows only) under-reports what the screen
      // owes an honest summary (spec §7; QA MAJOR 1). `unreadRows` counts
      // amount-bearing LINES, not blocks, so a block that swallowed three
      // rows reports three, not one (QA follow-up).
      const totalDropped = dropped + layout.unreadRows;
      // Belt-and-braces (QA MINOR 8): scanImage's own pre-cap (via
      // chooseScanRoute) already rejects an over-60-row LAYOUT before this
      // even runs; this catches the (currently impossible, since
      // rowsToDrafts never adds rows) case of the drafts array itself
      // somehow exceeding the cap.
      if (drafts.length > MAX_STATEMENT_ROWS) {
        setReply(
          `That's ${drafts.length} rows — I can take ${MAX_STATEMENT_ROWS} at a time. Try it in two shots.`
        );
        return;
      }
      if (drafts.length === 0) {
        setReply(
          totalDropped > 0
            ? "Those rows couldn't be read — try a clearer screenshot."
            : "I couldn't find any amounts on that screenshot. Statements work best as a full-screen screenshot of the transaction list."
        );
        return;
      }
      statementDroppedRef.current = totalDropped;
      const q = startQueue(drafts);
      setQueue(q);
      showCard(statementQueueCard(q, accounts));
      setParseSource('layout');
      const first = currentDraft(q)!;
      setPending(first);
      reconcileSuggestionsFor(first);
      // Real copy, not reviewProgress's "1 of 6" (QA MINOR 6) — a bare
      // progress label reads oddly as the very first thing Xavier says.
      setReply(`Found ${drafts.length} row${drafts.length === 1 ? '' : 's'} — let's go through them.`);
      await recordLayoutParse(statementScanLatencyRef.current);
    } finally {
      setBusy(false);
    }
  };

  const onChooseStatementAccount = (account: Account) => {
    const layout = statementAccountChoice;
    setStatementAccountChoice(null);
    if (layout) {
      // QA MAJOR 3: this call is void-ed (no caller awaits it — the sheet
      // has already closed by the time the user could react to anything),
      // so a listTransactions()/rowsToDrafts() failure would otherwise be
      // an unhandled rejection with no reply at all. `busy` is already
      // guaranteed clear either way by beginStatementQueue's own finally.
      void beginStatementQueue(layout, account).catch(() => {
        setReply("I couldn't read that photo — try a clearer shot.");
      });
    }
  };

  const onCancelStatementAccountChoice = () => setStatementAccountChoice(null);

  // Pre-selection for the account picker: an unambiguous header match, else
  // the default (first active) account — same fallback interpret() uses.
  const statementAccountPreselectId = useMemo(() => {
    if (!statementAccountChoice) return '';
    const activeAccounts = accounts.filter((a) => !a.archived);
    const headerMatch = findAccountMatch(statementAccountChoice.headerText, activeAccounts);
    return headerMatch?.account?.id ?? activeAccounts[0]?.id ?? '';
  }, [statementAccountChoice, accounts]);

  // This used to be ActionSheetIOS with an `anchor` node handle. That was the
  // documented way to position it, and it did not work: `anchor` is resolved
  // through the LEGACY UIManager view registry, but this app runs the New
  // Architecture (app.config.ts newArchEnabled), so the view is not in that
  // registry, the lookup yields nothing, and the sheet falls back to the
  // middle of the screen — nowhere near the control that opened it.
  //
  // Rather than fight a native presentation we cannot position, this uses the
  // app's own ContextMenu. The composer's camera glyph uses its `bottomRight`
  // (layout-anchored, no-Modal) mode — see onCameraTap. This function is now
  // only the widget deep link's fallback: no control to anchor to, so it asks
  // for the same ContextMenu, but in its `point`/Modal mode centred on the
  // screen (tested geometry in src/domain/contextMenuPlacement.ts).
  const onScanDeepLink = () => {
    if (busy) return;
    // {0,0} used to be passed here and placed the menu in the top-left
    // corner under the status bar — computeMenuPlacement anchors on the
    // point it is given, it does not interpret 0 as "unset".
    setDeepLinkPhotoMenuAt({ x: winWidth / 2, y: winHeight / 2 });
  };

  // Opens the photo-source menu anchored to the composer's own camera
  // control by layout, not by a captured point — see ContextMenu.tsx's
  // `bottomRight` anchor. Mirrors onPlus next to it: no coordinates in, the
  // control's own position in the tree does the placement.
  const onCameraTap = () => {
    if (busy) return;
    setPlusOpen(false);
    setPhotoMenuOpen(true);
  };

  // Fixed identities for the memoised DraftComposer, each running the
  // current render's handler — so neither a keystroke nor this screen's own
  // re-renders re-render the field for nothing (issue #27).
  const stableOnSend = useStableCallback(onSend);
  const stableOnPlus = useStableCallback(onPlus);
  const stableOnCameraTap = useStableCallback(onCameraTap);

  // Both photo-source menus (composer-anchored and the deep link's
  // screen-centred fallback) offer the same two items.
  const photoMenuItems: ContextMenuItem[] = [
    { label: 'Take photo', icon: 'camera', onPress: () => void capturePhoto() },
    { label: 'Choose from library', icon: 'image', onPress: () => void pickPhoto() },
  ];

  // Widget deep links (targets/widget → projectxavier://?focus=1 / ?scan=1):
  // `?focus=1` focuses the input, `?scan=1` opens the same action sheet the
  // camera button does. Each fires at most once per navigation — expo-router
  // keeps query params around across tab switches, so without the ref guards
  // going Home → another tab → Home would re-focus/re-open the sheet forever.
  // A plain app open (no params) never touches either ref.
  useEffect(() => {
    if (deepLinkParams.focus !== '1' || focusDeepLinkHandledRef.current) return;
    // The composer is UNMOUNTED while a draft or account card is up
    // (composerState.visible), so `inputRef.current` can be null here — it
    // never could when the field lived in an always-rendered bottom bar.
    // Don't consume the guard on a focus that didn't happen, or the widget's
    // "type an expense" entry point is dead for the rest of the session;
    // `composer.visible` is a dep, so this retries the moment the card
    // clears. Same idiom as the `?scan=1` effect's `busy` retry below.
    // `busy` too: the field is `editable={false}` then, so it cannot become
    // first responder and the guard would burn on a focus that never took.
    if (!inputRef.current || busy) return;
    focusDeepLinkHandledRef.current = true;
    inputRef.current.focus();
  }, [deepLinkParams.focus, composer.visible, busy]);

  useEffect(() => {
    if (deepLinkParams.scan !== '1' || scanDeepLinkHandledRef.current) return;
    // onScanDeepLink() itself no-ops while busy (see its `if (busy) return;`
    // above) — don't consume the ref in that case, so this effect retries
    // once `busy` clears (it's a dep below) instead of the deep link
    // silently doing nothing for good.
    if (busy) return;
    scanDeepLinkHandledRef.current = true;
    onScanDeepLink();
    // onScanDeepLink is intentionally omitted from the deps: it's a plain
    // const recreated every render, and the ref above is what makes this
    // once-per-navigation rather than the dependency array.
  }, [deepLinkParams.scan, busy]);

  // ── The feed (docs/design/xavier-daily-chat-spec.md §3, §6) ──────────────
  // ONE live card, from the screen's own flows (`liveCardOf`), drawn by the
  // existing interactive components at the newest end of the feed; every other
  // card is drawn by the feed from its stored payload.
  const budgetStored =
    !!budget.reply && budgetCard(budget.reply, { currency: appCurrency, text: '' }) !== null;
  const txPickerPhase: TxPickerLive['phase'] = txOpUpdateEditing
    ? 'editing'
    : txOpNeedsAccountChoice
      ? 'choosing_account'
      : 'picker';
  const screenCards: ScreenCards<ScreenValues> = {
    draft: pending,
    account_create: pendingAccount,
    account_update: pendingAccountUpdate,
    delete_handoff: deleteHandoff,
    query_answer: queryAnswer,
    tx_picker: txOp || txOpUpdateEditing ? { txOp, phase: txPickerPhase } : null,
    budget: budget.reply,
  };
  const liveOptions = { budgetReplyStored: budgetStored };
  const liveCard = liveCardOf(screenCards, liveOptions);
  const hasLiveCard = liveCard !== null;
  const tail = computeTail({
    busy,
    hasLiveCard,
    accountFlowStep: accountFlow && !pendingAccount ? accountFlow.step : null,
    fmRefusal: !!fmRefusal,
    budgetHint: !!budget.reply && !budgetStored,
  });
  // The check's inputs: the log, and which screen flows are set.
  const screenKey = LIVE_KINDS.filter((k) => screenCards[k] !== null).join('+');
  useEffect(() => {
    if (!__DEV__ || !chatLoaded) return;
    const problem = liveCardProblem(screenCards, liveOptions, (newestLiveCard(chatState)?.kind as ChatCardKind | undefined) ?? null);
    if (problem) console.warn(`[chat] ${problem}`);
  }, [chatState, chatLoaded, screenKey, budgetStored]);
  const feedRows = useMemo(
    () =>
      buildFeedRows(chatState, {
        hasLiveCard,
        tailActive: tail.active,
        onUnshown: (m) => {
          if (__DEV__) console.warn(`[chat] live_card_not_shown:${m.kind}`);
        },
      }),
    [chatState, hasLiveCard, tail.active]
  );
  // The layout phase machine (src/domain/chatFeed.ts `layoutPhaseReduce`):
  // 'loading' is a neutral frame; 'hero' the empty day; 'moving' the
  // hero-to-header transition, played when the first thing of the day arrives;
  // 'header' the chat. A day reopened with rows goes straight to 'header'.
  const quietDay = isQuietDay({ messageCount: chatState.messages.length, hasLiveCard, tail });
  const { phase, onMoveFinished } = useLayoutPhase({ loaded: chatLoaded, quiet: quietDay, resetEpoch: chatResetEpoch });

  // The one-time note leaves the stored flag on the hero -> moving edge (the first message).
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (shouldClearNoteOnPhase(prevPhaseRef.current, phase)) clearChatNotice();
    prevPhaseRef.current = phase;
  }, [phase]);

  const feedRef = useRef<ChatFeedHandle>(null);
  const feedNearBottomRef = useRef(true);
  const [showNewPill, setShowNewPill] = useState(false);
  // Sending scrolls to the newest directly (`scrollFeedToNewest` in the send
  // paths). This effect handles what arrives: decided per batch, any user
  // message added since the last look counts as sent; otherwise a Xavier
  // message scrolls only if the user is near the bottom, or raises the pill.
  const seenCountRef = useRef(0);
  const messageCount = chatState.messages.length;
  const lookedOnceRef = useRef(false);
  useEffect(() => {
    if (!chatLoaded) return;
    // The first look after the load only records what is there: the stored
    // day is neither announced nor treated as a send.
    const { event, xavier } = arrivalsSince(chatState, seenCountRef.current, !lookedOnceRef.current);
    lookedOnceRef.current = true;
    seenCountRef.current = messageCount;
    if (xavier.length) announceIncoming(xavier);
    if (!event) return;
    const action = scrollDecision(event, feedNearBottomRef.current);
    if (action === 'scroll') feedRef.current?.scrollToNewest();
    else if (action === 'pill') setShowNewPill(true);
    // Keyed on the count: an in-place update of a card is not a new message.
  }, [messageCount, chatLoaded]);
  const scrollFeedToNewest = () => {
    feedNearBottomRef.current = true;
    setShowNewPill(false);
    feedRef.current?.scrollToNewest();
  };
  const onFeedNearBottomChange = (near: boolean) => {
    feedNearBottomRef.current = near;
    setShowNewPill((shown) => pillStillNeeded(shown, near));
  };

  // ── A day reset (the daily rollover, or a restore) ───────────────────────
  // The log is already empty (`useChatLog().reset`). What the screen drops with it,
  // all of it belonging to the old day and none of it saved:
  //  - every live card and draft: the pending draft, account create/update,
  //    delete handoff, query answer, tx-op picker (and its sheets), the editor,
  //    the FM refusal, the budget reply (`budget.clear`), the statement queue and
  //    its account choice and scan image (resetActiveDraftState; an open queue
  //    row's parse metric resolves as 'discarded');
  //  - the account Q&A in progress, the "New" pill, the feed's scroll bookkeeping;
  //  - the ephemeral tail is derived from the state above, so it empties with it;
  //  - a late receipt (stamp moved) and, via the log's fence, the late result of a
  //    parse or save that was still running (see `busy` below).
  // Kept: the composer text (the user's own typing, not chat data), the avatar look.
  const seenResetEpochRef = useRef(chatResetEpoch);
  useEffect(() => {
    if (seenResetEpochRef.current === chatResetEpoch) return;
    seenResetEpochRef.current = chatResetEpoch;
    // An operation that started DURING the hold (the user's held send) is the new
    // day's: it is not fenced, so its draft and Q&A must not be wiped here.
    if (!(busyRef.current && !chat.isFenced())) {
      resetActiveDraftState();
      setAccountFlow(null);
      setPlusOpen(false);
      replyStampRef.current += 1;
    }
    setShowNewPill(false);
    seenCountRef.current = 0;
    feedNearBottomRef.current = true;
  }, [chatResetEpoch]);
  // The operation that was running when the day cleared has finished: whatever it
  // left on the screen is dropped, and the log records again.
  // Keyed on `busy` only: it reads the fence and the current closures at the moment
  // the operation ends, which is the one event that matters.
  useEffect(() => {
    if (busy || !chat.isFenced()) return;
    chat.unfence();
    resetActiveDraftState();
  }, [busy]);

  const liveHandlers: LiveHandlers = {
    draft: {
      accounts,
      categories,
      payees,
      suggestion,
      onUseSuggestion,
      onKeepPayee,
      categorySuggestion,
      onUseCategorySuggestion,
      onKeepCategory,
      onUseAccountSuggestion,
      onKeepAccount,
      onRevertLearnedCategory,
      onRevertLearnedAccount,
      ...(METRICS_ENABLED && !queue ? { onReportWrong } : {}),
      onSave: onConfirm,
      onDiscard,
      onEdit,
      source: parseSource,
      aiFallbackFrom,
      discardLabel: queue ? 'Skip' : undefined,
      sourceImage: scanSource,
      queueProgress: queue ? reviewProgress(queue) : null,
      onStopReviewing: () => void onStopReviewingQueue(),
    },
    accountCreate: {
      currency: appCurrency,
      onChangeName: onChangeAccountName,
      onChangeSubtype: onChangeAccountSubtype,
      onChangeBalanceText: onChangeAccountBalanceText,
      onCreate: onCreateAccount,
      onDiscard: onDiscardAccount,
    },
    accountUpdate: {
      currency: appCurrency,
      onChangeName: onChangeAccountUpdateName,
      onChangeSubtype: onChangeAccountUpdateSubtype,
      onChangeBalanceText: onChangeAccountUpdateBalanceText,
      onConfirm: onConfirmAccountUpdate,
      onDiscard: onDiscardAccountUpdate,
    },
    deleteHandoff: {
      onOpenInAccounts: onOpenDeleteHandoffInAccounts,
      onArchive: onArchiveFromDeleteHandoff,
      onDismiss: onDismissDeleteHandoff,
    },
    queryAnswer: { currency: appCurrency, onClear: onDismissQueryAnswer },
    txPicker: {
      accountsById,
      categoriesById,
      payeesById,
      busy,
      onPick: onPickTxOpCandidate,
      onDismiss: onDismissTxOp,
      onShowAll: () => setTxOpShowAllOpen(true),
      selectedIds: txOpSelectedIds,
      onToggleSelect: onToggleTxOpCandidate,
      onDeleteSelected: onDeleteSelectedTxOp,
    },
    budget: {
      replies: budget,
      currency: appCurrency,
      busy,
      onOpenBudget: () => router.push('/budget'),
    },
    busy,
  };
  // The live row reads this element from context, so the list's renderItem stays
  // stable and only the live row re-renders when the card changes.
  const liveSlot = liveCard ? <LiveCardSlot card={liveCard} h={liveHandlers} /> : null;

  const feedTail = (
    <FeedTail
      tail={tail}
      accountFlow={accountFlow}
      onCancelAccount={onDiscardAccount}
      onChooseSubtype={answerAccountFlow}
      onLogAnyway={onLogAnyway}
      onDismissFmRefusal={onDismissFmRefusal}
      busy={busy}
      budget={liveHandlers.budget}
    />
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // `automaticOffset` asks the library to read this view's true
      // screen-absolute position natively (viewPositionInWindow) instead of
      // inferring it from a layout rect that RN reports relative to the
      // parent. Without it the padding is computed against the wrong origin
      // and the row misses the keyboard — a hand-fitted
      // `keyboardVerticalOffset={-insets.top}` docked it on the simulator
      // and then buried the composer BEHIND the keyboard on device, which is
      // what a calibration constant does when the thing it stands in for is
      // a measurement. Nothing to re-measure per device now.
      automaticOffset
    >
      <View
        className="flex-1 bg-bg"
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: s.screenPadding,
          // Build 104 feedback (§12 E1): the composer moved OUT of the hero
          // to a sibling pinned above the tab bar (below), so this is now
          // the ONLY point that clears the floating bar — the tab-bar-sized
          // gap sits AFTER every flow child (the ScrollView, then the
          // composer row when it's mounted), same as it does when the
          // composer is hidden entirely (a draft/account card pending).
          // `automaticOffset` pads this whole view by the raw keyboard
          // height, measured from its own true screen-absolute frame — it
          // has no idea a static gap lives inside that frame, so a constant
          // `insets.bottom` here would still be sitting below the row once
          // the keyboard is up (this screen's own nested SafeAreaProvider
          // does NOT drop `insets.bottom` to 0 when the keyboard rises — see
          // the ScrollView comment this replaced, §11). So: clear the
          // floating tab bar at rest, and give back exactly what the
          // keyboard is already covering as it rises, down to a floor that
          // keeps the row off the keyboard's own edge. Keyed on the
          // KEYBOARD, never on focus — see `keyboardHeight`.
          paddingBottom: Math.max(
            insets.bottom + floatingBottomGap - keyboardHeight,
            floatingBottomGap
          ),
        }}
      >
        {/* First child, absolutely filling, content above it (glass-phase2 §4.6) */}
        <DepthField />
        {/* The chat area: hero, feed, pinned header and the ONE avatar share one frame. */}
        {/* While a resume check that may clear the day is in flight, the old rows
            must not show: the chat area is hidden (and inert) until it settles. */}
        <HeroHeaderStage
          hidden={chatHeld}
          phase={phase}
          onMoveFinished={onMoveFinished}
          avatarState={avatarState}
          loggedToday={chatDayKey === null ? null : loggedTodayCount(chatState, chatDayKey)}
          safeTop={insets.top + 8}
          edgeInset={s.screenPadding}
          greetingLabel={GREETING}
          greeting={<SpeechBubble content={textBubble(GREETING)} fontSize={s.role.body} maxWidth={300} />}
          note={showResetNote(chatNotice, phase) ? CHAT_RESET_NOTE_TEXT : null}
          onHeroBackgroundPress={onHeroBackgroundPress}
          renderFeed={(topInset) => (
            <LiveSlotContext.Provider value={liveSlot}>
              <ChatFeed
                ref={feedRef}
                rows={feedRows}
                tail={feedTail}
                topInset={topInset}
                showNewPill={showNewPill}
                onNewPillPress={scrollFeedToNewest}
                onNearBottomChange={onFeedNearBottomChange}
                onBackgroundInteraction={onHeroBackgroundPress}
              />
            </LiveSlotContext.Provider>
          )}
        />

        {/* The seated composer (composer-seated-with-xavier-spec.md), pinned
            above the tab bar (§12 E1 — the fallback §8 reserved: seating it
            in the hero left a large dead band above the bar and put the
            first tap high on a 6.9" screen). A sibling of the ScrollView, not
            inside it, so a long reply/card can never carry it off-screen
            (§10's carried-not-fixed note about the hero-docked version).
            Hidden entirely while a draft/account card owns the screen
            (`composer.visible`). Wrapped in `position:'relative'` so the
            slash/"+" popover — a sibling, not the scroll view — rides with
            the row. */}
        {composer.visible && (
          <View style={{ position: 'relative', alignSelf: 'stretch', marginTop: 8 }}>
            {showSlashPopover && (
              <SlashMenu
                rows={slashRows}
                onPick={runSlashCommand}
                onAddManually={onPlusAddManually}
                onExamples={openExamplesSheet}
              />
            )}
            {/* Photo source, anchored to the composer itself (not a captured
                touch point) via ContextMenu's `bottomRight` mode — a sibling
                of Composer inside this same `position:'relative'` row, so it
                rides with the row instead of being left behind when the
                keyboard dismisses and the row resettles above the tab bar.
                Both items feed the same scanImage, which decides receipt vs.
                statement from the layout itself (docs/design/unified-scan-
                spec.md §4.2) — the user never has to pick which one this is.
                Declared BEFORE <Composer/> so it paints above the row it
                hangs off, and so VoiceOver reaches the menu before the field
                it covers — the same order SlashMenu already uses. */}
            <ContextMenu
              visible={photoMenuOpen}
              anchor={{ kind: 'bottomRight' }}
              onDismiss={() => setPhotoMenuOpen(false)}
              items={photoMenuItems}
            />
            <DraftComposer
              ref={composerHandleRef}
              initialText={draftRef.current}
              onTextChange={onDraftChange}
              placeholder={inputPlaceholder}
              onSubmit={stableOnSend}
              editable={!busy}
              inputRef={inputRef}
              showPlus={composer.showPlus}
              onPlus={stableOnPlus}
              showCamera={composer.showCamera}
              showSend={composer.showSend}
              onCamera={stableOnCameraTap}
            />
          </View>
        )}

        <AssistantExamplesSheet
          visible={examplesSheetOpen}
          onPickExample={onPickExample}
          onOpenByok={() => router.push('/settings/byok')}
          onClose={() => setExamplesSheetOpen(false)}
        />

        {/* Photo source for the widget deep link only (`?scan=1`) — there is
            no control to anchor to there, so this instance stays in
            ContextMenu's `point`/Modal mode, centred on the screen. See
            onScanDeepLink. */}
        <ContextMenu
          visible={deepLinkPhotoMenuAt !== null}
          anchor={{ kind: 'point', x: deepLinkPhotoMenuAt?.x ?? 0, y: deepLinkPhotoMenuAt?.y ?? 0 }}
          onDismiss={() => setDeepLinkPhotoMenuAt(null)}
          items={photoMenuItems}
        />

        {/* "Which account is this from?" (docs/design/statement-scan-spec.md
            §4.4 point 4) — only shown when the user has more than one
            account; a single-account user skips straight to the queue (see
            scanImage). */}
        {/* "Raise <category> budget" — hoisted out of the list: a modal does not
            belong inside a virtualised cell that can unmount. */}
        <BudgetEditSheet
          visible={budget.edit !== null}
          target={budget.edit?.target ?? null}
          month={budget.edit?.month ?? monthKeyOf(Date.now())}
          currency={appCurrency}
          onClose={budget.closeEdit}
          onSave={budget.onEditSave}
        />

        {statementAccountChoice && (
          <AccountPickerSheet
            visible
            title="Which account is this from?"
            accounts={accounts.filter((a) => !a.archived)}
            selectedId={statementAccountPreselectId}
            onSelect={onChooseStatementAccount}
            onClose={onCancelStatementAccountChoice}
          />
        )}

        {pending && editorInitial && (
          <TransactionFormSheet
            visible={editorOpen}
            onClose={() => { setEditorOpen(false); setEditorError(null); setReportWrong(false); }}
            title="Edit transaction"
            mode="add"
            accounts={accounts}
            categories={categories}
            payees={payees}
            currency={pending.currency}
            showRepeat
            initial={editorInitial}
            onSave={onEditSave}
            {...(METRICS_ENABLED && pending.sourceText
              ? { parseReport: { checked: reportWrong, onToggle: setReportWrong } }
              : {})}
            busy={busy}
            error={editorError}
          />
        )}

        {/* §5.6 "which account?" step — a real, distinct picker (not the
            row list), reusing the same AccountPickerSheet the transaction
            form already uses. */}
        {txOp && (
          <AccountPickerSheet
            visible={txOpNeedsAccountChoice}
            title="Which account?"
            accounts={accounts.filter((a) => !a.archived)}
            selectedId=""
            onSelect={onChooseTxOpAccount}
            onClose={onDismissTxOpAccountChoice}
          />
        )}

        {/* §5.4 ">5" overflow — top 3 render inline (above); this is
            "Show all N", a plain Modal (same proven pattern as
            AccountPickerSheet) rather than BottomSheet, which stacks a
            second sheet over this screen's own KeyboardAvoidingView in a
            way that hasn't been device-verified (spec §12 open question 4). */}
        {txOp && (
          <TxOpShowAllSheet
            visible={txOpShowAllOpen}
            txOp={txOp}
            accountsById={accountsById}
            categoriesById={categoriesById}
            payeesById={payeesById}
            onPick={onPickTxOpCandidate}
            onClose={() => setTxOpShowAllOpen(false)}
            selectedIds={txOpSelectedIds}
            onToggleSelect={onToggleTxOpCandidate}
            onDeleteSelected={onDeleteSelectedTxOp}
          />
        )}

        {/* Chat transaction UPDATE (spec §5.5) — a SECOND, independent
            TransactionFormSheet instance for editing an EXISTING, already-
            saved row (mode: 'edit'); never the same instance the pending AI
            draft above uses, and never open at the same time (both flows
            clear the other's state — see runParse's reset block and
            onPickTxOpCandidate). */}
        {txOpUpdateEditing && txOpUpdateInitial && (
          <TransactionFormSheet
            visible
            onClose={onCloseTxOpUpdateEditor}
            title="Update transaction"
            mode="edit"
            accounts={accounts}
            categories={categories}
            payees={payees}
            currency={txOpUpdateEditing.currency}
            initial={txOpUpdateInitial}
            onSave={onTxOpUpdateSave}
            busy={busy}
            error={txOpEditorError}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
