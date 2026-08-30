/**
 * Assistant home — the assistant avatar is the centerpiece. The user describes
 * an expense ("12 bucks lunch at Joe's") or snaps a receipt; the on-device
 * parse tiers (Apple Foundation Models, then the deterministic heuristic)
 * parse it, the pure assistant logic decides whether to save / ask / block,
 * and confirmed entries are saved. The chat feed has been removed — the avatar
 * stays hero-sized and vertically centered at all times.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
} from 'react-native';
// Keyboard-controller's KeyboardAvoidingView is driven frame-for-frame by the
// native keyboard animation (unlike RN's, which desyncs and briefly reveals the
// window background — the white flash). Requires the root KeyboardProvider.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { AssistantAvatar } from '../../src/components/AssistantAvatar';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { TransactionRow } from '../../src/components/ui/TransactionRow';
import { icons } from '../../src/theme/assets';
import { useThemeColors } from '../../src/theme/useThemeColors';
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
import { interpret, TransactionDraft } from '../../src/domain/assistant';
import {
  isAccountCommand,
  transactionCommandBody,
  startAccountFlow,
  advanceAccountFlow,
  buildReadyAccountFromChat,
  normalizeSubtype,
  parseOpeningBalance,
  ACCOUNT_SUBTYPE_CHOICES,
  AccountFlowState,
  ReadyAccount,
} from '../../src/domain/accountAssistant';
import { detectAccountIntent, extractAccountReferenceFragment } from '../../src/domain/accountIntent';
import { detectQueryIntent } from '../../src/domain/queryIntent';
import { detectTransactionOpCandidate } from '../../src/domain/transactionOpIntent';
import {
  buildCandidateFilter,
  selectCandidates,
  pickerSizeFor,
  SHEET_INLINE_PREVIEW_COUNT,
  fingerprintTransaction,
  fingerprintsMatch,
  summarizeTransactionSelection,
  TransactionCandidateFilter,
  CandidateFilterContext,
  DroppedConstraint,
  TransactionSelectionSummary,
} from '../../src/domain/transactionCandidates';
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
import { AnswerCard } from '../../src/components/assistant/AnswerCard';
import { ComparisonCard } from '../../src/components/assistant/ComparisonCard';
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
  isSlashQuery,
  AssistantCommand,
} from '../../src/domain/assistantCommands';
import { AssistantExamplesSheet } from '../../src/components/ui/AssistantExamplesSheet';
import { ContextMenu } from '../../src/components/ui/ContextMenu';
import { AccountPickerSheet } from '../../src/components/ui/AccountPickerSheet';
import { localParse } from '../../src/domain/localParse';
import {
  isDeviceAiAvailable,
  deviceParse,
  deviceParseAccount,
  deviceParseAccountUpdate,
  deviceParseQuerySelection,
  deviceParseTransactionOp,
} from '../../src/features/ai/deviceParse';
import { runQueryLoop } from '../../src/features/ai/queryLoop';
import { isUsefulDeviceParse } from '../../src/domain/deviceParsePrompt';
import { aiParsedExpenseSchema, AiParsedExpense } from '../../src/lib/validation';
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
import { findPayeeMatch, normalizeName, resolveCategoryId } from '../../src/domain/payees';
import { findCategoryMatch } from '../../src/domain/categories';
import { confidenceBucket, inputLenBucket } from '../../src/domain/parseMetrics';
import {
  recordParse,
  resolveParse,
  ParseOutcome,
} from '../../src/features/diagnostics/parseMetrics';
import { getRecognizer } from '../../src/features/ocr/appleVisionRecognizer';
import { classifyOcrText } from '../../src/domain/ocrResult';
import { formatMoney } from '../../src/domain/money';
import { backfillOccurrences } from '../../src/domain/recurrence';
import { formatDMY, isSameDay } from '../../src/domain/dates';
import { Account, Category, Payee, Transaction } from '../../src/domain/types';
import {
  TransactionFormSheet,
  FormValues,
} from '../../src/components/transactions/TransactionFormSheet';
import { avatarStateFor, AssistantOutcomeKind } from '../../src/domain/avatar';

const GREETING = "Hi, I'm Xavier. Tell me about an expense, or snap a receipt.";

/** Which engine produced a draft, for an honest source pill on the confirm
 *  card: 'on_device' = Apple Foundation Models (the default AI tier),
 *  'heuristic' = the deterministic offline floor, 'openai'/'anthropic' = a
 *  BYOK cloud provider (docs/design/byok-spec.md — only ever set when the
 *  user opted in and supplied their own key). Module-scope (not declared
 *  inside AssistantScreen) so DraftCard's props can share the exact same
 *  type instead of a second, separately-maintained union. */
type ParseSource = 'on_device' | 'heuristic' | 'openai' | 'anthropic';

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

/** Chat transaction delete/update picker state (docs/design/chat-
 *  transaction-delete-update-spec.md §5.4/§5.6) — one card at a time, same
 *  shape as pendingAccount/pendingAccountUpdate/deleteHandoff/queryAnswer.
 *  `op` is the ONE enum the model (or the deterministic floor) emitted; the
 *  model never sees or picks a row — only `candidates` + the user's tap do. */
interface TxOpState {
  op: 'delete' | 'update';
  filter: TransactionCandidateFilter;
  /** The ledger snapshot loaded when this picker was built — reused by the
   *  §5.6 account-choice step so it doesn't need a second DB read. */
  transactions: Transaction[];
  candidates: Transaction[];
  droppedConstraints: DroppedConstraint[];
  /** getDataRevision() captured at build time — the picker is cleared if
   *  this no longer matches on focus (spec §9.5), so a user returning from
   *  the Transactions tab never taps a row that was changed/deleted there. */
  dataRevision: number;
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

/** "· 🔁" / "🔁 recurring" — the SAME treatment app/(tabs)/transactions.tsx's
 *  own renderItem uses for a posted recurring occurrence (spec §9.3: the
 *  picker row must show it's recurring). Kept as its own small helper here
 *  since that file's inline expression isn't exported. */
function txOpCategoryLabel(tx: Transaction, categoryName: string | undefined): string | undefined {
  if (categoryName) return tx.seriesId ? `${categoryName} · 🔁` : categoryName;
  return tx.seriesId ? '🔁 recurring' : undefined;
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

export default function AssistantScreen() {
  const c = useThemeColors();
  // Responsive type/spacing scale (docs/design/responsive-scaling-spec.md) —
  // role sizes + width-aware avatar/chip/composer dimensions, re-derived on
  // rotation/split-view since it reads useWindowDimensions().
  const s = useScaledType();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Widget deep links: `projectxavier://?focus=1` and `?scan=1` (see
  // targets/widget and docs/design/xavier-widget-spec.md). Handled below,
  // once onScan/inputRef exist — see the effect near onScan's definition.
  const deepLinkParams = useLocalSearchParams<{ focus?: string; scan?: string }>();
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState(GREETING);
  const [pending, setPending] = useState<TransactionDraft | null>(null);
  // Account-creation spike: /account walks a Q&A (accountFlow), then a complete
  // draft (pendingAccount) shows a confirm card. appCurrency stamps the account.
  const [accountFlow, setAccountFlow] = useState<AccountFlowState | null>(null);
  const [pendingAccount, setPendingAccount] = useState<ReadyAccount | null>(null);
  // Chat account UPDATE (docs/design/account-chat-crud-spec.md §5.2) — an
  // editable confirm card, pre-filled with the resolved target + change.
  const [pendingAccountUpdate, setPendingAccountUpdate] = useState<
    (AccountUpdateDraft & { accountId: string; currentName: string }) | null
  >(null);
  // Chat account DELETE handoff (spec §5.3) — recognize + hand off ONLY;
  // never executes. Offers "Open in Accounts" (deep link) and an inline
  // "Archive instead" one-tap alternative.
  const [deleteHandoff, setDeleteHandoff] = useState<{
    accountId: string;
    accountName: string;
    deepLink: string;
  } | null>(null);
  // Ask-Xavier query answer (docs/design/ask-xavier-queries-spec.md §5.4) —
  // a tool result + secondary caption, rendered as a chat answer card. Mirrors
  // pendingAccount/pendingAccountUpdate's "one card at a time" shape.
  const [queryAnswer, setQueryAnswer] = useState<{
    tool: QueryToolName;
    result: unknown;
    caption: string | null;
    // BYOK multi-call comparison (docs/design/ask-xavier-queries-spec.md
    // §5.4, device bug build 58) — set only when `buildQueryComparison`
    // recognised a genuine same-tool, different-period, single-scalar-
    // amount comparison across the tool loop's own calls; the card renders
    // this INSTEAD of `tool`/`result` when present (see the render site).
    comparison: QueryComparison | null;
  } | null>(null);
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
  const [busy, setBusy] = useState(false);
  // Last transient outcome, for the avatar's reaction.
  const [lastOutcome, setLastOutcome] = useState<AssistantOutcomeKind>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
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
  // Where the receipt-source menu should appear: the pageX/pageY of the control
  // the user touched. null = closed. See onScan for why this is a plain point
  // rather than a native anchor handle.
  const [scanMenuAt, setScanMenuAt] = useState<{ x: number; y: number } | null>(null);
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
    typing: draft.trim().length > 0,
    lastOutcome,
  });

  // A "confused" reaction (a parse error or a clarify prompt) used to persist
  // until the next parse or a success, leaving Xavier looking stuck. Settle it
  // back to idle after a moment — the same way the 'spent'/'saved' reactions
  // self-clear — so a one-off error doesn't freeze the confused face. (Typing a
  // retry clears it immediately via avatarStateFor; this handles the case where
  // the user just leaves it.) Re-runs on every outcome change, so the cleanup
  // cancels a stale timer whenever a new outcome arrives.
  useEffect(() => {
    if (lastOutcome !== 'error' && lastOutcome !== 'clarify') return;
    const timer = setTimeout(() => setLastOutcome(null), 4000);
    return () => clearTimeout(timer);
  }, [lastOutcome]);

  // Shared idle-gate for both "extra surfaces" — the quick-action chips and
  // the slash popover. Neither may render while a draft card, account draft,
  // or the /account Q&A owns the screen: they'd sit in/over the same region
  // as the confirm card and could intercept its Create/Discard taps.
  const noOverlay =
    !pending &&
    !pendingAccount &&
    !accountFlow &&
    !pendingAccountUpdate &&
    !deleteHandoff &&
    !queryAnswer &&
    !txOp &&
    !txOpUpdateEditing;
  // Idle hero: also not busy. Chips hide the moment any of those become true.
  const showQuickActions = noOverlay && !busy;

  // Slash-command popover: derived from the field text (so the chip shortcut
  // and typed "/" stay in lockstep, see src/domain/assistantCommands.ts), but
  // only while `noOverlay` — same idle-gate as the quick-action chips above.
  // Kept as its own boolean (not just `slashItems.length > 0`) because the
  // popover also carries the "What can I ask?" row, which isn't one of
  // `slashItems` and must stay visible even while a filter (e.g. "/x") matches
  // no command.
  const showSlashPopover = noOverlay && isSlashQuery(draft);
  const slashItems = showSlashPopover ? matchCommands(draft) : [];

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
      setTxOp((p) => (p && p.dataRevision !== revision ? null : p));

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

  async function runParse(text: string, options?: { forceExpense?: boolean }) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setPending(null);
    setSuggestion(null);
    setCategorySuggestion(null);
    setParseSource(null);
    setLastOutcome(null);
    setEditorOpen(false);
    setEditorError(null);
    setQueryAnswer(null);
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
    const trimmed = text.trim();
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
    // Computed once per runParse (not per fallback branch) and threaded onto
    // every recordParse call so the metric shows whether the on-device tier
    // was even an option, regardless of which engine actually served the parse.
    let deviceAiCapable = false;

    // FM-first tier — the DEFAULT (and only AI) parse engine: parse on-device
    // with Apple Foundation Models whenever the device supports it (private,
    // no network). Returns true only when it produced a usable parse
    // (isUsefulDeviceParse); otherwise the caller falls through to the
    // deterministic heuristic floor below.
    async function runFmParse(): Promise<boolean> {
      if (!deviceAiCapable) return false;
      const fm = await deviceParse(trimmed, {
        categories: cats,
        payees: pays,
        accounts: accts,
        now,
        currency: appCurrency,
      });
      // Only accept the on-device result when it's actually usable — a
      // schema-valid-but-empty parse (no amount) is worse than falling through
      // to the heuristic. (isUsefulDeviceParse is the same rule deviceParse's
      // cold-start retry keys off.)
      if (fm && isUsefulDeviceParse(fm)) {
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
          setPending({ ...outcome.draft, sourceText: trimmed });
          setParseSource('on_device');
          // Same local fuzzy reconcile as the heuristic-success path below.
          if (outcome.draft.payeeName) {
            const { suggestion: near } = findPayeeMatch(outcome.draft.payeeName, pays);
            setSuggestion(near ?? null);
          }
          if (outcome.draft.categoryName) {
            const { suggestion: nearCat } = findCategoryMatch(
              outcome.draft.categoryName,
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
      // output failed schema validation, or it parsed but produced no amount).
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
        setPending({ ...outcome.draft, sourceText: trimmed });
        setParseSource(provider);
        if (outcome.draft.payeeName) {
          const { suggestion: near } = findPayeeMatch(outcome.draft.payeeName, pays);
          setSuggestion(near ?? null);
        }
        if (outcome.draft.categoryName) {
          const { suggestion: nearCat } = findCategoryMatch(
            outcome.draft.categoryName,
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
      const localParsed = localParse(trimmed, {
        categories: cats,
        payees: pays,
        now,
        currency: appCurrency,
      });
      // Treat the heuristic's own output as untrusted too (guardrail #6) —
      // safeParse so a malformed local parse can never throw.
      const validated = aiParsedExpenseSchema.safeParse(localParsed);
      if (!validated.success) return false;
      const outcome = interpret(validated.data, { accounts: accts, now, text: trimmed });
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
        deviceAiCapable,
        latencyMs: 0,
      });

      if (outcome.kind === 'confirm') {
        // Attach the user's words so they persist on save (sourceText).
        setPending({ ...outcome.draft, sourceText: trimmed });
        setParseSource('heuristic');
        // Same local fuzzy reconcile as the FM-success path above.
        if (outcome.draft.payeeName) {
          const { suggestion: near } = findPayeeMatch(outcome.draft.payeeName, pays);
          setSuggestion(near ?? null);
        }
        if (outcome.draft.categoryName) {
          const { suggestion: nearCat } = findCategoryMatch(
            outcome.draft.categoryName,
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

      const engineOrder: EngineId[] = routeEngines({
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
          setQueryAnswer({
            tool: served.call.tool,
            result: served.result,
            caption: served.caption,
            comparison: served.comparison,
          });
          setReply("Here's what I found.");
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
        setPendingAccountUpdate({
          accountId: match.account.id,
          currentName: match.account.name,
          ...draft,
        });
        setPendingAccount(null);
        setAccountFlow(null);
        setReply(accountUpdateConfirmMessage(match.account, draft, appCurrency));
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
      for (const engine of engineOrder) {
        currentEngine = engine;
        if (await ENGINE_RUNNERS[engine]()) return;
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
    setPending(null);
    setPendingAccount(null);
    // Belt-and-braces: the Q&A never sets this itself (only the chat one-shot
    // gate in runParse does), but clear it anyway so a stale id left over from
    // an abandoned expense parse can never be mistaken for this account's
    // metric when onCreateAccount/onDiscardAccount later resolve it.
    parseIdRef.current = null;
    const res = startAccountFlow();
    setAccountFlow(res.state);
    setReply(res.message);
  };

  // Advance the /account Q&A with `answer` — shared by the typed reply
  // (onSend, mid-flow) and the tap-don't-type subtype chips, so a chip and a
  // typed answer land on identical state via the same advanceAccountFlow call.
  const answerAccountFlow = (answer: string) => {
    if (!accountFlow) return;
    const res = advanceAccountFlow(accountFlow, answer, appCurrency);
    setAccountFlow(res.state);
    setReply(res.message);
    if (res.ready) setPendingAccount(res.ready);
  };

  const onSend = async () => {
    // Mirror the busy-guard the other action handlers have (onCreateAccount/
    // onConfirm/onEditSave) — a Send tapped while a prior action's async
    // window (e.g. onCreateAccount's loadContext) is still in flight would
    // otherwise race it. Guard before consuming `draft` so a no-op tap keeps
    // the text.
    if (busy) return;
    const text = draft;
    setDraft('');
    const t = text.trim();
    if (!t) return;

    // "/account" → start the guided account-creation Q&A.
    if (isAccountCommand(t)) {
      startAccountCreation();
      return;
    }
    // Mid Q&A → treat this message as the answer to the current question.
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
    if (txBody === '') {
      setReply("Sure — what's the transaction?");
      return;
    }
    await runParse(txBody ?? text, txBody != null ? { forceExpense: true } : undefined);
  };

  // "≡ All commands" chip / typed "/" → open the slash popover without
  // submitting anything (slashItems is derived from `draft`, so setting it to
  // "/" is enough to show the menu).
  const openAllCommands = () => {
    setDraft('/');
    inputRef.current?.focus();
  };

  // A tapped slash-menu row runs the command. "/account" needs no argument,
  // so it goes straight through the same startAccountCreation() the chip and
  // the typed command use. "/transactions" leaves a trailing space and keeps
  // focus so the user types the expense, matching onSend's empty-body reply.
  const runSlashCommand = (cmd: AssistantCommand) => {
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
      // Only meaningful for a chat one-shot gate hit (src/domain/parseMetrics.ts
      // — the /account Q&A never sets this); resolveParse no-ops on a null id.
      void resolveParse(parseIdRef.current, { resolved: 'saved' });
      parseIdRef.current = null;
      setPendingAccount(null);
      setAccountFlow(null);
      setReply(`Created "${name}". Anything else?`);
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
    setReply('No problem — cancelled. What else?');
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
      void resolveParse(parseIdRef.current, { resolved: 'saved' });
      parseIdRef.current = null;
      setPendingAccountUpdate(null);
      setReply(`Updated "${pendingAccountUpdate.newName}". Anything else?`);
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
    setReply('No problem — cancelled. What else?');
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

  // Shared "flow ended with nothing else on screen to explain itself" reset —
  // every genuine abandon/dismiss path below (never a completed one, which
  // always sets its own specific message like "Saved! Anything else?") calls
  // this instead of leaving `reply` untouched. A dangling prompt from a card/
  // sheet that's no longer there reads as a bug ("Here's what I found."
  // dangling above nothing was the first instance of this — see
  // onDismissQueryAnswer, the original model for this rule); centralising it
  // here means every exit path stays in sync instead of drifting one at a time.
  const resetReplyToIdle = () => setReply(GREETING);

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
    setDeleteHandoff(null);
    // The handoff flow ends on THIS screen — the delete/archive itself
    // happens over on manage-accounts — so the prompt it asked must not
    // still be sitting here when the user comes back.
    resetReplyToIdle();
    router.push({ pathname: '/manage-accounts', params: { deleteAccountId: accountId } });
  };

  const onArchiveFromDeleteHandoff = async () => {
    if (!deleteHandoff || busy) return;
    setBusy(true);
    try {
      const existing = accounts.find((a) => a.id === deleteHandoff.accountId);
      if (!existing) throw new Error('account no longer exists');
      await updateAccount({ ...existing, archived: true });
      setReply(`Archived "${deleteHandoff.accountName}". Anything else?`);
      setDeleteHandoff(null);
      await loadContext();
    } catch {
      setReply("I couldn't archive that account — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onDismissDeleteHandoff = () => {
    setDeleteHandoff(null);
    resetReplyToIdle();
  };

  // Clear the Ask-Xavier answer card. Until this existed, `queryAnswer` was
  // reset ONLY inside runParse's own reset block — so the single way to get rid
  // of an answer was to ask something else, and a card sat there for the rest
  // of the session (including across tab switches). Also resets `reply`,
  // because "Here's what I found." dangling above nothing reads as a bug.
  const onDismissQueryAnswer = () => {
    setQueryAnswer(null);
    resetReplyToIdle();
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
    setTxOp(null);
    setTxOpNeedsAccountChoice(false);
    setTxOpSelectedIds(new Set());
    resetReplyToIdle();
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
                const counterparty =
                  fresh.type === 'transfer' && fresh.transferAccountId
                    ? accountsById.get(fresh.transferAccountId)?.name
                    : undefined;
                setTxOp(null);
                setTxOpNeedsAccountChoice(false);
                setTxOpSelectedIds(new Set());
                setReply(
                  counterparty
                    ? `Deleted. ${counterparty}'s balance also changed. Anything else?`
                    : 'Deleted. Anything else?'
                );
                setLastOutcome('saved');
                await loadContext();
                setTimeout(() => setLastOutcome(null), 2500);
              } finally {
                setBusy(false);
              }
            },
          },
        ]);
      } else {
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
              const counterparties = summary.transferCounterpartyNames.join(', ');
              setTxOp(null);
              setTxOpNeedsAccountChoice(false);
              setTxOpSelectedIds(new Set());
              setReply(
                summary.transferCounterpartyNames.length > 0
                  ? `Deleted ${fresh.length}. ${counterparties}'s balance${
                      summary.transferCounterpartyNames.length === 1 ? '' : 's'
                    } also changed. Anything else?`
                  : `Deleted ${fresh.length}. Anything else?`
              );
              setLastOutcome('saved');
              await loadContext();
              setTimeout(() => setLastOutcome(null), 2500);
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
    setTxOpUpdateEditing(null);
    setTxOpEditorError(null);
    // `txOp` itself is already null by this point (onPickTxOpCandidate
    // clears it before opening this editor) — cancelling here is a genuine
    // abandon of the whole flow, so the picker's "Found N matching
    // transactions — which one…?" prompt must not linger once it's gone.
    resetReplyToIdle();
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
      setTxOpUpdateEditing(null);
      setTxOpEditorError(null);
      setReply('Updated! Anything else?');
      setLastOutcome('saved');
      await loadContext();
      setTimeout(() => setLastOutcome(null), 2500);
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
      setPending(null);
      setSuggestion(null);
      setCategorySuggestion(null);
      setParseSource(null);
      setReply('Saved! Anything else?');
      setLastOutcome(pendingType === 'expense' ? 'spent' : 'saved');
      await loadContext();
      // Let the reaction play, then settle back to idle.
      setTimeout(() => setLastOutcome(null), 2500);
    } catch {
      setReply("I couldn't save that — please try again.");
      setLastOutcome('error');
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = () => {
    void resolveParse(parseIdRef.current, { resolved: 'discarded' });
    parseIdRef.current = null;
    setPending(null);
    setSuggestion(null);
    setCategorySuggestion(null);
    setParseSource(null);
    setLastOutcome(null);
    setReply('No problem — discarded. What else?');
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

  const onEdit = () => setEditorOpen(true);

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
      setEditorOpen(false);
      setPending(null);
      setSuggestion(null);
      setCategorySuggestion(null);
      setParseSource(null);
      setReply('Saved! Anything else?');
      setLastOutcome(values.type === 'expense' ? 'spent' : 'saved');
      await loadContext();
      setTimeout(() => setLastOutcome(null), 2500);
    } catch {
      setEditorError('Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // On-device OCR turns the photo into text; the image never leaves the
  // device and the text goes to the same local parse ladder as typing.
  const ocrReceipt = async (uri: string) => {
    setBusy(true);
    try {
      const text = await getRecognizer().recognize(uri);
      const outcome = classifyOcrText(text);
      if (outcome.kind === 'empty') {
        setReply("I couldn't find any text on that receipt — try a clearer shot.");
        return;
      }
      await runParse(outcome.text);
    } catch {
      setReply("I couldn't read that photo — try a clearer shot.");
    } finally {
      setBusy(false);
    }
  };

  const captureReceipt = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setReply('I need camera access to scan a receipt.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;
    await ocrReceipt(shot.assets[0].uri);
  };

  const pickReceipt = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    await ocrReceipt(picked.assets[0].uri);
  };

  // Opens at the point the user actually touched.
  //
  // This used to be ActionSheetIOS with an `anchor` node handle. That was the
  // documented way to position it, and it did not work: `anchor` is resolved
  // through the LEGACY UIManager view registry, but this app runs the New
  // Architecture (app.config.ts newArchEnabled), so the view is not in that
  // registry, the lookup yields nothing, and the sheet falls back to the
  // middle of the screen — nowhere near the control that opened it.
  //
  // Rather than fight a native presentation we cannot position, this uses the
  // app's own ContextMenu, which takes plain pageX/pageY and places itself
  // with the tested geometry in src/domain/contextMenuPlacement.ts. No native
  // handle, no architecture dependency.
  const onScan = (at?: { x: number; y: number } | null) => {
    if (busy) return;
    // Camera or an already-taken photo (screenshots of e-receipts included).
    // A missing point (the widget deep link, which has no tapped control)
    // falls back to the screen centre, which is the honest default there.
    setScanMenuAt(at ?? { x: 0, y: 0 });
  };

  // Widget deep links (targets/widget → projectxavier://?focus=1 / ?scan=1):
  // `?focus=1` focuses the input, `?scan=1` opens the same action sheet the
  // camera button does. Each fires at most once per navigation — expo-router
  // keeps query params around across tab switches, so without the ref guards
  // going Home → another tab → Home would re-focus/re-open the sheet forever.
  // A plain app open (no params) never touches either ref.
  useEffect(() => {
    if (deepLinkParams.focus === '1' && !focusDeepLinkHandledRef.current) {
      focusDeepLinkHandledRef.current = true;
      inputRef.current?.focus();
    }
  }, [deepLinkParams.focus]);

  useEffect(() => {
    if (deepLinkParams.scan !== '1' || scanDeepLinkHandledRef.current) return;
    // onScan() itself no-ops while busy (see its `if (busy) return;` above) —
    // don't consume the ref in that case, so this effect retries once `busy`
    // clears (it's a dep below) instead of the deep link silently doing
    // nothing for good.
    if (busy) return;
    scanDeepLinkHandledRef.current = true;
    onScan();
    // onScan is intentionally omitted from the deps: it's a plain const
    // recreated every render, and the ref above is what makes this
    // once-per-navigation rather than the dependency array.
  }, [deepLinkParams.scan, busy]);

  const inputBar = (
    <>
      <View className="flex-row items-center mt-2" style={{ gap: 8 }}>
        <Pressable
          className="rounded-pill bg-surfaceAlt items-center justify-center"
          style={{ width: s.composerHeight, height: s.composerHeight }}
          onPress={(e) => onScan({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
          accessibilityLabel="Scan receipt"
        >
          <Feather name={icons.camera} color={c.text} size={20} />
        </Pressable>
        <TextInput
          ref={inputRef}
          className="flex-1 bg-surface text-text rounded-pill"
          // A fixed lineHeight (~1.25x the font size) keeps iOS from
          // mis-centering and clipping descenders at the bottom, same fix as
          // ui/Input.tsx — just scaled to the dynamic body size here.
          style={{
            height: s.composerHeight,
            paddingHorizontal: 18,
            fontSize: s.role.body,
            lineHeight: Math.round(s.role.body * 1.25),
            letterSpacing: 0,
          }}
          value={draft}
          onChangeText={setDraft}
          placeholder={inputPlaceholder}
          placeholderTextColor={c.muted}
          onSubmitEditing={onSend}
          returnKeyType="send"
          editable={!busy}
        />
        <Pressable
          className="rounded-pill bg-primary items-center justify-center"
          style={{
            width: s.composerHeight,
            height: s.composerHeight,
            shadowColor: c.primary,
            shadowOpacity: 0.5,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
          onPress={onSend}
          accessibilityLabel="Send"
        >
          <Feather name={icons.send} color="#fff" size={20} />
        </Pressable>
      </View>
      <Link
        href="/transactions"
        style={{ color: c.muted, textAlign: 'center', marginTop: 12, fontSize: s.role.caption }}
      >
        Prefer to type it in? Add manually
      </Link>
    </>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        className="flex-1 bg-bg pb-4"
        style={{ paddingTop: insets.top + 8, paddingHorizontal: s.screenPadding }}
      >
        {/* Centered content column — plain ScrollView guards against keyboard
            overlap when the DraftCard is visible. */}
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Vertically centered hero area — flex:1 + centered content so tall
              screens distribute space instead of leaving an empty band below
              a fixed-height cluster (was a fixed minHeight:340). */}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            {/* Step N of 3 + Cancel while the /account Q&A is active (hidden
                once the confirm card takes over — that card owns Discard). */}
            {accountFlow && !pendingAccount && (
              <AccountFlowProgress step={accountFlow.step} onCancel={onDiscardAccount} />
            )}
            {/* Shrink Xavier mid-Q&A so the progress line + question + chips
                read as one compact group instead of floating around a
                hero-sized face; no animation — just swap the size prop
                (width-derived: idle 148/160/180, flow 104/112/124). */}
            <AssistantAvatar
              size={accountFlow ? s.avatarFlow : s.avatarIdle}
              state={avatarState}
            />
            {/* Idle greeting (and other assistant replies) use the body role;
                the /account Q&A's questions promote to the prompt role — no
                numberOfLines, so Dynamic Type grows and wraps instead of
                clipping. */}
            <Text
              className="text-text text-center font-bold mt-6"
              style={{
                fontSize: accountFlow ? s.role.prompt : s.role.body,
                lineHeight: Math.round((accountFlow ? s.role.prompt : s.role.body) * 1.3),
                maxWidth: accountFlow ? 320 : 300,
              }}
            >
              {reply}
            </Text>
            {/* Tap-don't-type choices for the /account Q&A's "subtype" step —
                the text field still accepts a free-typed answer. */}
            {accountFlow?.step === 'subtype' && (
              <SubtypeChoiceChips onChoose={answerAccountFlow} />
            )}
            {/* Quick-action chips — idle hero only; gone the instant a draft
                card, account draft, or Q&A is active. */}
            {showQuickActions && (
              <QuickActionChips
                onNewAccount={() => {
                  setDraft('');
                  startAccountCreation();
                }}
                onScanReceipt={onScan}
                onAllCommands={openAllCommands}
                c={c}
                s={s}
              />
            )}
            {busy && !pending && (
              <ActivityIndicator color={c.primary} style={{ marginTop: 12 }} />
            )}
          </View>

          {/* Draft card + payee suggestion (when a parse is confirmed) */}
          {pending && (
            <View style={{ paddingBottom: 8 }}>
              <DraftCard
                draft={pending}
                accounts={accounts}
                categories={categories}
                payees={payees}
                suggestion={suggestion}
                onUseSuggestion={onUseSuggestion}
                onKeepPayee={onKeepPayee}
                categorySuggestion={categorySuggestion}
                onUseCategorySuggestion={onUseCategorySuggestion}
                onKeepCategory={onKeepCategory}
                onSave={onConfirm}
                onDiscard={onDiscard}
                onEdit={onEdit}
                source={parseSource}
              />
              {busy && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
            </View>
          )}

          {/* Account confirm card — from the /account Q&A or a chat one-shot
              gate hit (docs/design/account-chat-creation-spec.md §5.4); every
              field is editable before Create. */}
          {pendingAccount && (
            <View style={{ paddingBottom: 8 }}>
              <AccountDraftCard
                account={pendingAccount}
                currency={appCurrency}
                onChangeName={onChangeAccountName}
                onChangeSubtype={onChangeAccountSubtype}
                onChangeBalanceText={onChangeAccountBalanceText}
                onCreate={onCreateAccount}
                onDiscard={onDiscardAccount}
              />
              {busy && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
            </View>
          )}

          {/* Account UPDATE confirm card — docs/design/account-chat-crud-
              spec.md §5.2; every field pre-filled from the resolved target +
              classified change, editable before Confirm. */}
          {pendingAccountUpdate && (
            <View style={{ paddingBottom: 8 }}>
              <AccountUpdateDraftCard
                draft={pendingAccountUpdate}
                currency={appCurrency}
                onChangeName={onChangeAccountUpdateName}
                onChangeSubtype={onChangeAccountUpdateSubtype}
                onChangeBalanceText={onChangeAccountUpdateBalanceText}
                onConfirm={onConfirmAccountUpdate}
                onDiscard={onDiscardAccountUpdate}
              />
              {busy && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
            </View>
          )}

          {/* Chat DELETE handoff — docs/design/account-chat-crud-spec.md
              §5.3: the reply above already names the impact; this offers
              "Open in Accounts" (the ONLY place that can actually delete) and
              a one-tap "Archive instead" alternative. Never executes a
              delete itself. */}
          {deleteHandoff && (
            <View style={{ paddingBottom: 8 }}>
              <DeleteHandoffActions
                accountName={deleteHandoff.accountName}
                onOpenInAccounts={onOpenDeleteHandoffInAccounts}
                onArchive={onArchiveFromDeleteHandoff}
                onDismiss={onDismissDeleteHandoff}
              />
              {busy && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
            </View>
          )}

          {/* Ask-Xavier answer card (docs/design/ask-xavier-queries-spec.md
              §5.4) — a tool result rendered as a chart/stat/list card, with a
              secondary caption underneath (BYOK narration, or a deterministic
              template for FM/floor). Numbers on the card come ONLY from the
              tool result, never from any model prose. A recognised BYOK
              multi-call COMPARISON (device bug, build 58 —
              `src/domain/queryComparison.ts`) renders as a bar-per-period
              chart instead of the single-result card; the model's own
              narration still renders as the caption underneath either way. */}
          {queryAnswer && (
            <View style={{ paddingBottom: 8 }}>
              {/* Dismiss lives at the BLOCK level, not inside AnswerCard, so it
                  covers the comparison branch below as well as the card one —
                  putting it in AnswerCard would have left comparisons
                  un-clearable, which is the same bug in a narrower form. */}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Pressable
                  onPress={onDismissQueryAnswer}
                  accessibilityRole="button"
                  accessibilityLabel="Clear answer"
                  hitSlop={10}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingVertical: 6,
                    paddingHorizontal: 8,
                  }}
                >
                  <Feather name="x" size={13} color={c.muted} />
                  <Text className="text-muted text-xs">Clear</Text>
                </Pressable>
              </View>
              {queryAnswer.comparison ? (
                <View style={{ gap: 6 }}>
                  <ComparisonCard comparison={queryAnswer.comparison} currency={appCurrency} />
                  {queryAnswer.caption ? (
                    <Text className="text-muted text-xs px-1">{queryAnswer.caption}</Text>
                  ) : null}
                </View>
              ) : (
                <AnswerCard
                  tool={queryAnswer.tool}
                  result={queryAnswer.result}
                  currency={appCurrency}
                  caption={queryAnswer.caption}
                />
              )}
              {busy && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
            </View>
          )}

          {/* Chat transaction delete/update picker (docs/design/chat-
              transaction-delete-update-spec.md §5.4) — the model already
              said delete/update; this is the deterministic, model-free row
              picker. §5.6's "which account?" step (only for an oversized,
              account-unresolved list with more than one account) renders
              INSTEAD of the normal picker until resolved. */}
          {txOp && !txOpNeedsAccountChoice && (
            <View style={{ paddingBottom: 8 }}>
              <TransactionOpPicker
                txOp={txOp}
                accountsById={accountsById}
                categoriesById={categoriesById}
                payeesById={payeesById}
                busy={busy}
                onPick={onPickTxOpCandidate}
                onDismiss={onDismissTxOp}
                onShowAll={() => setTxOpShowAllOpen(true)}
                selectedIds={txOpSelectedIds}
                onToggleSelect={onToggleTxOpCandidate}
                onDeleteSelected={onDeleteSelectedTxOp}
              />
            </View>
          )}
        </ScrollView>

        {/* Input bar always pinned at the bottom. Wrapped in a `relative`
            container so the slash-command popover — a sibling of the bar, not
            the scroll view — rides with it above the keyboard instead of
            scrolling away. */}
        <View style={{ position: 'relative' }}>
          {showSlashPopover && (
            <SlashMenu items={slashItems} onPick={runSlashCommand} onExamples={openExamplesSheet} />
          )}
          {inputBar}
        </View>

        <AssistantExamplesSheet
          visible={examplesSheetOpen}
          onPickExample={onPickExample}
          onOpenByok={() => router.push('/settings/byok')}
          onClose={() => setExamplesSheetOpen(false)}
        />

        {/* Receipt source, anchored to the control the user touched — see
            onScan for why this is our own menu rather than ActionSheetIOS. */}
        <ContextMenu
          visible={scanMenuAt !== null}
          x={scanMenuAt?.x ?? 0}
          y={scanMenuAt?.y ?? 0}
          onDismiss={() => setScanMenuAt(null)}
          items={[
            {
              label: 'Take photo',
              icon: 'camera',
              onPress: () => void captureReceipt(),
            },
            {
              label: 'Choose from library',
              icon: 'image',
              onPress: () => void pickReceipt(),
            },
          ]}
        />

        {pending && editorInitial && (
          <TransactionFormSheet
            visible={editorOpen}
            onClose={() => { setEditorOpen(false); setEditorError(null); }}
            title="Edit transaction"
            mode="add"
            accounts={accounts}
            categories={categories}
            payees={payees}
            currency={pending.currency}
            showRepeat
            initial={editorInitial}
            onSave={onEditSave}
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

function DraftCard({
  draft,
  accounts,
  categories,
  payees,
  suggestion,
  onUseSuggestion,
  onKeepPayee,
  categorySuggestion,
  onUseCategorySuggestion,
  onKeepCategory,
  onSave,
  onDiscard,
  onEdit,
  source,
}: {
  draft: TransactionDraft;
  accounts: Account[];
  categories: Category[];
  payees: Payee[];
  suggestion: Payee | null;
  onUseSuggestion: () => void;
  onKeepPayee: () => void;
  categorySuggestion: Category | null;
  onUseCategorySuggestion: () => void;
  onKeepCategory: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onEdit: () => void;
  /** Which engine produced this draft, for an honest source pill — see the
   *  module-scope ParseSource type. */
  source?: ParseSource | null;
}) {
  const c = useThemeColors();
  const isTransfer = draft.type === 'transfer';
  const accountName =
    accounts.find((a) => a.id === draft.accountId)?.name ?? 'Account';
  const money = formatMoney(draft.amount, draft.currency);
  // Transfers move money between the user's own accounts — neither a gain nor
  // a loss overall — so the amount is shown plain, with no +/- sign.
  const signed = isTransfer ? money : draft.type === 'expense' ? `-${money}` : `+${money}`;
  const tone = isTransfer ? 'text-text' : draft.type === 'expense' ? 'text-negative' : 'text-positive';

  // "New" badges: the parsed name has no exact match in the user's full local
  // list and no active "did you mean…?" chip already covering it (chip and
  // badge are mutually exclusive per entity).
  const payeeIsNew =
    !!draft.payeeName &&
    !suggestion &&
    !payees.some((p) => normalizeName(p.name) === normalizeName(draft.payeeName!));
  const categoryIsNew =
    !!draft.categoryName &&
    !categorySuggestion &&
    !categories.some(
      (c) => c.kind === draft.type && normalizeName(c.name) === normalizeName(draft.categoryName!)
    );

  return (
    <Card className="border-borderAccent self-stretch">
      <View className="flex-row items-center justify-between mb-2.5" style={{ gap: 8, flexWrap: 'wrap' }}>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Text className="text-text text-sm font-bold capitalize">{draft.type}</Text>
          {draft.pending && (
            <View className="bg-surfaceAlt border border-border rounded-pill px-1.5 py-0.5">
              <Text className="text-muted text-[9px] font-bold uppercase tracking-wide">
                Pending
              </Text>
            </View>
          )}
        </View>
        {source === 'heuristic' ? (
          <Text className="text-muted text-[11px] font-bold border border-border rounded-pill px-2 py-0.5">
            Offline
          </Text>
        ) : source === 'on_device' ? (
          <Text className="text-primary text-[11px] font-bold border border-borderAccent rounded-pill px-2 py-0.5">
            On-device
          </Text>
        ) : source === 'openai' ? (
          <Text className="text-primary text-[11px] font-bold border border-borderAccent rounded-pill px-2 py-0.5">
            OpenAI
          </Text>
        ) : source === 'anthropic' ? (
          <Text className="text-primary text-[11px] font-bold border border-borderAccent rounded-pill px-2 py-0.5">
            Anthropic
          </Text>
        ) : (
          <Text className="text-primary text-[11px] font-bold border border-borderAccent rounded-pill px-2 py-0.5">
            AI parsed
          </Text>
        )}
      </View>
      <Field k="Amount" v={signed} valueClassName={tone} />
      {draft.mismatchedCurrency ? (
        <Text className="text-[11px] text-negative mb-1 -mt-1">
          Heard "{draft.mismatchedCurrency}" — this account is in {draft.currency}. Tap
          Edit to enter the amount in {draft.currency}.
        </Text>
      ) : null}
      {draft.defaulted.account ? (
        <DefaultedField
          label={isTransfer ? 'From' : 'Account'}
          value={`${accountName}?`}
          onPress={onEdit}
          c={c}
        />
      ) : (
        <Field k={isTransfer ? 'From' : 'Account'} v={accountName} />
      )}
      {draft.unmatchedAccountName ? (
        <Text className="text-[11px] text-negative mb-1 -mt-1">
          "{draft.unmatchedAccountName}" not found — using {accountName}
        </Text>
      ) : null}
      {isTransfer ? (
        <Field k="To" v={draft.transferAccountName ?? '—'} />
      ) : (
        <>
          {draft.defaulted.payee ? (
            <DefaultedField label="Payee" value={draft.payeeName ?? 'Add'} onPress={onEdit} c={c} />
          ) : (
            <Field k="Payee" v={draft.payeeName ?? '—'} badge={payeeIsNew ? 'New' : undefined} />
          )}
          {draft.defaulted.category ? (
            <DefaultedField label="Category" value={draft.categoryName ?? 'Add'} onPress={onEdit} c={c} />
          ) : (
            <Field
              k="Category"
              v={draft.categoryName ?? '—'}
              badge={categoryIsNew ? 'New' : undefined}
            />
          )}
        </>
      )}
      {draft.defaulted.date ? (
        <DefaultedField label="Date" value={`${dateLabel(draft.occurredAt)}?`} onPress={onEdit} c={c} />
      ) : (
        <Field k="Date" v={dateLabel(draft.occurredAt)} />
      )}
      {/* A note is only attached when `groundedNote` accepted it (see
          domain/deviceParsePrompt.ts), but the user still has to be able to
          SEE what is about to be saved — silently attaching model-authored
          text to a transaction is the thing this row exists to prevent. Edit
          clears or rewrites it like any other field. */}
      {draft.note ? <Field k="Note" v={draft.note} /> : null}

      {suggestion && draft.payeeName ? (
        <View className="mt-3 rounded-md border border-primary bg-surfaceAlt p-3">
          <Text className="text-text text-[13px]">
            Did you mean <Text className="font-bold">{suggestion.name}</Text>?
          </Text>
          <View className="flex-row mt-2.5" style={{ gap: 8 }}>
            <Button
              title={`Keep "${draft.payeeName}"`}
              variant="ghost"
              onPress={onKeepPayee}
              className="flex-1"
            />
            <Button
              title={`Use ${suggestion.name}`}
              variant="primary"
              onPress={onUseSuggestion}
              className="flex-1"
            />
          </View>
        </View>
      ) : null}

      {categorySuggestion && draft.categoryName ? (
        <View className="mt-3 rounded-md border border-primary bg-surfaceAlt p-3">
          <Text className="text-text text-[13px]">
            Did you mean <Text className="font-bold">{categorySuggestion.name}</Text>?
          </Text>
          <View className="flex-row mt-2.5" style={{ gap: 8 }}>
            <Button
              title={`Keep "${draft.categoryName}"`}
              variant="ghost"
              onPress={onKeepCategory}
              className="flex-1"
            />
            <Button
              title={`Use ${categorySuggestion.name}`}
              variant="primary"
              onPress={onUseCategorySuggestion}
              className="flex-1"
            />
          </View>
        </View>
      ) : null}

      <View className="flex-row mt-3" style={{ gap: 10 }}>
        <Button title="Discard" variant="ghost" onPress={onDiscard} className="flex-1" />
        <Button title="Edit" variant="ghost" onPress={onEdit} className="flex-1" />
        <Button title="Save" variant="primary" onPress={onSave} className="flex-1" />
      </View>
    </Card>
  );
}

function Field({
  k,
  v,
  valueClassName = 'text-text',
  badge,
}: {
  k: string;
  v: string;
  valueClassName?: string;
  badge?: string;
}) {
  return (
    <View className="flex-row justify-between items-center py-1.5">
      <Text className="text-muted text-[13px]">{k}</Text>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <Text className={`text-[13px] font-semibold ${valueClassName}`}>{v}</Text>
        {badge ? (
          <Text className="text-muted text-[10px] font-bold border border-borderAccent rounded-pill px-1.5 py-0.5">
            {badge}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A field the assistant defaulted/guessed rather than parsed. Renders as an
 *  amber "tap to fix" pill instead of a plain row; tapping opens the editor. */
function DefaultedField({
  label,
  value,
  onPress,
  c,
}: {
  label: string;
  value: string;
  onPress: () => void;
  c: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View className="flex-row justify-between items-center py-1.5">
      <Text className="text-muted text-[13px]">{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: guessed, tap to change`}
        className="flex-row items-center rounded-pill border border-amber px-2 py-0.5"
        style={{ gap: 4 }}
      >
        <Text className="text-amber text-[13px] font-semibold">{value}</Text>
        <Feather name="chevron-right" size={14} color={c.amber} />
      </Pressable>
    </View>
  );
}

function dateLabel(ms: number): string {
  return isSameDay(ms, Date.now()) ? 'Today' : formatDMY(ms);
}

/** A field row for AccountDraftCard, scaled with the responsive type ramp.
 *  Kept separate from the shared `Field` above (used by the ordinary
 *  transaction DraftCard) so that card stays pixel-identical — only the
 *  /account confirm card promotes to the new scale. `mono` renders the value
 *  in the monospace family with tabular figures, for the Starting-balance row. */
function AccountField({
  k,
  v,
  valueClassName = 'text-text',
  mono = false,
}: {
  k: string;
  v: string;
  valueClassName?: string;
  mono?: boolean;
}) {
  const s = useScaledType();
  return (
    <View className="flex-row justify-between items-center py-1.5">
      <Text className="text-muted" style={{ fontSize: s.role.caption }}>
        {k}
      </Text>
      <Text
        className={`font-semibold ${mono ? 'font-mono' : ''} ${valueClassName}`}
        style={{ fontSize: s.role.body, fontVariant: mono ? ['tabular-nums'] : undefined }}
      >
        {v}
      </Text>
    </View>
  );
}

/** Minor units -> a plain major-unit string a user can re-edit and have
 *  `parseOpeningBalance` read back exactly ("500", "-200") — no currency
 *  symbol/thousands separators, since those still parse fine but aren't
 *  needed for the initial seed. */
function formatBalanceInput(minorUnits: number): string {
  return (minorUnits / 100).toString();
}

/** Confirm card for an account — from the /account Q&A or a chat one-shot
 *  gate hit (docs/design/account-chat-creation-spec.md §5.4). Every field is
 *  editable: name is a plain text field, subtype is a chip picker
 *  (ACCOUNT_SUBTYPE_CHOICES — the same words the /account Q&A's own subtype
 *  question already understands), and the starting balance is free text read
 *  back through the same deterministic `parseOpeningBalance` the chat
 *  one-shot's own balance comes from — so a defaulted "Wallet"/wrong subtype/
 *  guessed balance is a one-tap-or-type fix before Create. */
function AccountDraftCard({
  account,
  currency,
  onChangeName,
  onChangeSubtype,
  onChangeBalanceText,
  onCreate,
  onDiscard,
}: {
  account: ReadyAccount;
  currency: string;
  onChangeName: (name: string) => void;
  onChangeSubtype: (subtype: string) => void;
  onChangeBalanceText: (text: string) => void;
  onCreate: () => void;
  onDiscard: () => void;
}) {
  const c = useThemeColors();
  const s = useScaledType();
  // Locally owned raw text so the field reads naturally while typing ("-",
  // "1,250.5", a bare "."); the parent's `pendingAccount.openingBalance` (what
  // Create actually persists) only ever comes from parseOpeningBalance(this
  // text) via onChangeBalanceText. Seeded once at mount from the incoming
  // draft — later balance changes come from the user's own typing, not from
  // `account` re-rendering with a new value.
  const [balanceText, setBalanceText] = useState(() =>
    formatBalanceInput(account.openingBalance)
  );
  const isPositive = account.openingBalance >= 0;
  const balTone = isPositive ? 'text-positive' : 'text-negative';

  return (
    <Card className="border-borderAccent self-stretch">
      <View className="flex-row items-center justify-between mb-2.5">
        <Text className="text-text font-bold" style={{ fontSize: s.role.prompt }}>
          New account
        </Text>
        <Text
          className="text-primary font-bold border border-borderAccent rounded-pill px-2.5 py-1"
          style={{ fontSize: 12 }}
        >
          Assistant
        </Text>
      </View>

      <View className="py-1.5">
        <Text className="text-muted mb-1" style={{ fontSize: s.role.caption }}>
          Name
        </Text>
        <TextInput
          value={account.name}
          onChangeText={onChangeName}
          accessibilityLabel="Account name"
          className="bg-surfaceAlt text-text rounded-md px-3"
          style={{ height: 40, fontSize: s.role.body }}
        />
      </View>

      <View className="py-1.5">
        <Text className="text-muted mb-1" style={{ fontSize: s.role.caption }}>
          Type
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {ACCOUNT_SUBTYPE_CHOICES.map((choice) => {
            const selected = account.subtype === choice.value;
            return (
              <Pressable
                key={choice.value}
                onPress={() => onChangeSubtype(choice.value)}
                accessibilityLabel={`Set account type ${choice.label}`}
                className={`rounded-pill items-center justify-center ${
                  selected ? 'bg-primary' : 'bg-surfaceAlt'
                }`}
                style={{ minHeight: s.chipHeight, paddingHorizontal: 16 }}
              >
                <Text
                  className={`font-semibold ${selected ? 'text-white' : 'text-text'}`}
                  style={{ fontSize: s.role.control }}
                >
                  {choice.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <AccountField k="Currency" v={currency} />

      <View className="py-1.5">
        <Text className="text-muted mb-1" style={{ fontSize: s.role.caption }}>
          Starting balance
        </Text>
        <TextInput
          value={balanceText}
          onChangeText={(t) => {
            setBalanceText(t);
            onChangeBalanceText(t);
          }}
          keyboardType="numbers-and-punctuation"
          accessibilityLabel="Starting balance"
          className={`bg-surfaceAlt rounded-md px-3 font-mono font-semibold ${balTone}`}
          style={{ height: 40, fontSize: s.role.body, fontVariant: ['tabular-nums'] }}
        />
      </View>

      <View className="flex-row mt-3" style={{ gap: 10 }}>
        <Pressable
          onPress={onDiscard}
          accessibilityLabel="Discard account"
          className="flex-1 rounded-pill bg-surfaceAlt items-center justify-center"
          style={{ height: 50 }}
        >
          <Text className="text-text font-bold" style={{ fontSize: s.role.control }}>
            Discard
          </Text>
        </Pressable>
        <Pressable
          onPress={onCreate}
          accessibilityLabel="Create account"
          className="flex-1 rounded-pill bg-primary items-center justify-center"
          style={{
            height: 50,
            shadowColor: c.primary,
            shadowOpacity: 0.5,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
          <Text className="text-white font-bold" style={{ fontSize: s.role.control }}>
            Create
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

/** Confirm card for a chat account UPDATE gate hit (docs/design/account-
 *  chat-crud-spec.md §5.2) — mirrors AccountDraftCard's shape/style exactly,
 *  just for an EXISTING account: name/subtype/balance are all editable
 *  before Confirm, and `updateAccount` only ever runs after that tap. */
function AccountUpdateDraftCard({
  draft,
  currency,
  onChangeName,
  onChangeSubtype,
  onChangeBalanceText,
  onConfirm,
  onDiscard,
}: {
  draft: AccountUpdateDraft & { accountId: string; currentName: string };
  currency: string;
  onChangeName: (name: string) => void;
  onChangeSubtype: (subtype: string) => void;
  onChangeBalanceText: (text: string) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const c = useThemeColors();
  const s = useScaledType();
  const [balanceText, setBalanceText] = useState(() => formatBalanceInput(draft.newBalance));
  const isPositive = draft.newBalance >= 0;
  const balTone = isPositive ? 'text-positive' : 'text-negative';

  return (
    <Card className="border-borderAccent self-stretch">
      <View className="flex-row items-center justify-between mb-2.5">
        <Text className="text-text font-bold" style={{ fontSize: s.role.prompt }}>
          Update account
        </Text>
        <Text
          className="text-primary font-bold border border-borderAccent rounded-pill px-2.5 py-1"
          style={{ fontSize: 12 }}
        >
          Assistant
        </Text>
      </View>

      <AccountField k="Account" v={draft.currentName} />

      <View className="py-1.5">
        <Text className="text-muted mb-1" style={{ fontSize: s.role.caption }}>
          Name
        </Text>
        <TextInput
          value={draft.newName}
          onChangeText={onChangeName}
          accessibilityLabel="New account name"
          className="bg-surfaceAlt text-text rounded-md px-3"
          style={{ height: 40, fontSize: s.role.body }}
        />
      </View>

      <View className="py-1.5">
        <Text className="text-muted mb-1" style={{ fontSize: s.role.caption }}>
          Type
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {ACCOUNT_SUBTYPE_CHOICES.map((choice) => {
            const selected = draft.newSubtype === choice.value;
            return (
              <Pressable
                key={choice.value}
                onPress={() => onChangeSubtype(choice.value)}
                accessibilityLabel={`Set account type ${choice.label}`}
                className={`rounded-pill items-center justify-center ${
                  selected ? 'bg-primary' : 'bg-surfaceAlt'
                }`}
                style={{ minHeight: s.chipHeight, paddingHorizontal: 16 }}
              >
                <Text
                  className={`font-semibold ${selected ? 'text-white' : 'text-text'}`}
                  style={{ fontSize: s.role.control }}
                >
                  {choice.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <AccountField k="Currency" v={currency} />

      <View className="py-1.5">
        <Text className="text-muted mb-1" style={{ fontSize: s.role.caption }}>
          Balance
        </Text>
        <TextInput
          value={balanceText}
          onChangeText={(t) => {
            setBalanceText(t);
            onChangeBalanceText(t);
          }}
          keyboardType="numbers-and-punctuation"
          accessibilityLabel="New balance"
          className={`bg-surfaceAlt rounded-md px-3 font-mono font-semibold ${balTone}`}
          style={{ height: 40, fontSize: s.role.body, fontVariant: ['tabular-nums'] }}
        />
      </View>

      <View className="flex-row mt-3" style={{ gap: 10 }}>
        <Pressable
          onPress={onDiscard}
          accessibilityLabel="Discard account update"
          className="flex-1 rounded-pill bg-surfaceAlt items-center justify-center"
          style={{ height: 50 }}
        >
          <Text className="text-text font-bold" style={{ fontSize: s.role.control }}>
            Discard
          </Text>
        </Pressable>
        <Pressable
          onPress={onConfirm}
          accessibilityLabel="Confirm account update"
          className="flex-1 rounded-pill bg-primary items-center justify-center"
          style={{
            height: 50,
            shadowColor: c.primary,
            shadowOpacity: 0.5,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
          <Text className="text-white font-bold" style={{ fontSize: s.role.control }}>
            Confirm
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

/** Chat delete handoff actions (docs/design/account-chat-crud-spec.md §5.3)
 *  — the reply text above this already names the impact; this card offers
 *  "Open in Accounts" (deep-links to the ONLY screen that can actually
 *  delete) and a one-tap "Archive instead" non-destructive alternative.
 *  Deliberately has NO "Delete" button of its own — chat never executes. */
function DeleteHandoffActions({
  accountName,
  onOpenInAccounts,
  onArchive,
  onDismiss,
}: {
  accountName: string;
  onOpenInAccounts: () => void;
  onArchive: () => void;
  onDismiss: () => void;
}) {
  const c = useThemeColors();
  const s = useScaledType();
  return (
    <Card className="border-borderAccent self-stretch">
      <Text className="text-text font-bold mb-2.5" style={{ fontSize: s.role.prompt }}>
        Delete {accountName}?
      </Text>
      <View style={{ gap: 10 }}>
        <Pressable
          onPress={onOpenInAccounts}
          accessibilityLabel="Open in Accounts to delete"
          className="rounded-pill bg-primary items-center justify-center"
          style={{ height: 50, shadowColor: c.primary, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}
        >
          <Text className="text-white font-bold" style={{ fontSize: s.role.control }}>
            Open in Accounts
          </Text>
        </Pressable>
        <Pressable
          onPress={onArchive}
          accessibilityLabel="Archive instead"
          className="rounded-pill bg-surfaceAlt items-center justify-center"
          style={{ height: 50 }}
        >
          <Text className="text-text font-bold" style={{ fontSize: s.role.control }}>
            Archive instead
          </Text>
        </Pressable>
        <Pressable onPress={onDismiss} accessibilityLabel="Dismiss">
          <Text className="text-muted text-center font-semibold" style={{ fontSize: s.role.caption }}>
            Never mind
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

/** A ≥44pt tick box around a smaller visual box — same "big Pressable,
 *  small visual" shape as SwipeableRow's own action buttons
 *  (src/components/ui/SwipeableRow.tsx's SwipeActionButton), including its
 *  plain-object-`style` + local pressed-state convention (never
 *  function-form `style` — .eslintrc.js bans it, since NativeWind's
 *  cssInterop silently swallows it). Multi-select delete only (docs/design/
 *  chat-transaction-delete-update-spec.md §13 amendment) — never rendered
 *  for update. */
function TxOpCheckbox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  const c = useThemeColors();
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onToggle}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={checked ? 'Selected' : 'Not selected'}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: checked ? 0 : 2,
          borderColor: c.controlBorder,
          backgroundColor: checked ? c.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked && <Feather name="check" size={14} color="#fff" />}
      </View>
    </Pressable>
  );
}

/** One picker row — payee, amount, account AND date (spec §5.4: "every row
 *  shows payee, amount, date AND account" — the picker has no day-grouping
 *  header the way the ledger does, so `dateLabel` is required here, unlike
 *  every other TransactionRow caller). Recurring rows get the same "· 🔁"
 *  treatment as the ledger (spec §9.3); a transfer's row already names the
 *  counterparty via TransactionRow's own `transferAccountName` handling
 *  (spec §9.1/#14 — disclosed in both the row and the delete confirm).
 *
 *  `selectable` (spec §13 amendment, multi-select delete) renders a leading
 *  checkbox; the checkbox AND the row itself both call the SAME `onPress`
 *  (the caller passes a toggle, not an immediate pick, whenever
 *  `selectable` is true) so either gesture works and there is exactly one
 *  code path to reason about. */
function TxOpCandidateRow({
  tx,
  accountsById,
  categoriesById,
  payeesById,
  onPress,
  selectable = false,
  selected = false,
}: {
  tx: Transaction;
  accountsById: Map<string, Account>;
  categoriesById: Map<string, Category>;
  payeesById: Map<string, Payee>;
  /** Omitted on the confirm card, where the row is deliberately inert and the
   *  explicit Delete/Edit button is the only way to act. */
  onPress?: () => void;
  selectable?: boolean;
  selected?: boolean;
}) {
  const row = (
    <TransactionRow
      tx={tx}
      accountName={accountsById.get(tx.accountId)?.name ?? 'Unknown account'}
      transferAccountName={
        tx.transferAccountId ? accountsById.get(tx.transferAccountId)?.name : undefined
      }
      categoryName={txOpCategoryLabel(
        tx,
        tx.categoryId ? categoriesById.get(tx.categoryId)?.name : undefined
      )}
      payeeName={tx.payeeId ? payeesById.get(tx.payeeId)?.name : undefined}
      dateLabel={dateLabel(tx.occurredAt)}
      onPress={onPress}
    />
  );
  if (!selectable) return row;
  return (
    <View className="flex-row items-center" style={{ gap: 4 }}>
      <TxOpCheckbox checked={selected} onToggle={onPress ?? (() => {})} />
      <View style={{ flex: 1 }}>{row}</View>
    </View>
  );
}

/** The chat transaction delete/update picker card (docs/design/chat-
 *  transaction-delete-update-spec.md §5.4) — sized per `pickerSizeFor`:
 *  0 = a named-search "nothing found" state + "Open Transactions" (never a
 *  silent no-op, spec §9.4); 1 = a confirm card (still requires an explicit
 *  tap — never auto-executes, spec §7 acceptance #9); 2-5 = every candidate
 *  inline; >5 = the first 3 inline plus "Show all N" (rendered by
 *  TxOpShowAllSheet, a sibling of this card).
 *
 *  Multi-select delete (§13 amendment) — DELETE ONLY, never update — takes
 *  over rows once there is more than one candidate: a row tap toggles a
 *  checkbox instead of immediately picking, and a count-labelled destructive
 *  action appears once ≥1 is ticked. The 1-candidate confirm card stays a
 *  single row with the SAME `onPick` every size used before (Change 1 adds
 *  an explicit primary action there; it never becomes a checklist). */
function TransactionOpPicker({
  txOp,
  accountsById,
  categoriesById,
  payeesById,
  busy,
  onPick,
  onDismiss,
  onShowAll,
  selectedIds,
  onToggleSelect,
  onDeleteSelected,
}: {
  txOp: TxOpState;
  accountsById: Map<string, Account>;
  categoriesById: Map<string, Category>;
  payeesById: Map<string, Payee>;
  busy: boolean;
  onPick: (tx: Transaction) => void;
  onDismiss: () => void;
  onShowAll: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDeleteSelected: () => void;
}) {
  const c = useThemeColors();
  const s = useScaledType();
  const router = useRouter();
  const size = pickerSizeFor(txOp.candidates.length);
  const verb = txOp.op === 'delete' ? 'Delete' : 'Update';
  // Delete-only, and only once there's more than one candidate — a single
  // candidate stays the Change-1 confirm card, never a 1-row checklist
  // (requirement #6 of the multi-select amendment).
  const multiSelect = txOp.op === 'delete' && size !== 'confirm';

  if (size === 'none') {
    return (
      <Card className="border-borderAccent self-stretch">
        <Text className="text-text font-bold mb-2.5" style={{ fontSize: s.role.prompt }}>
          Nothing to {verb.toLowerCase()}
        </Text>
        <Text className="text-muted text-[13px] mb-3">
          I couldn't find a matching transaction to {verb.toLowerCase()}.
        </Text>
        <View className="flex-row" style={{ gap: 10 }}>
          <Button title="Dismiss" variant="ghost" onPress={onDismiss} className="flex-1" />
          <Button
            title="Open Transactions"
            variant="primary"
            onPress={() => {
              onDismiss();
              router.push('/transactions');
            }}
            className="flex-1"
          />
        </View>
      </Card>
    );
  }

  const visibleCandidates =
    size === 'sheet' ? txOp.candidates.slice(0, SHEET_INLINE_PREVIEW_COUNT) : txOp.candidates;

  return (
    <Card className="border-borderAccent self-stretch">
      <Text className="text-text font-bold mb-2.5" style={{ fontSize: s.role.prompt }}>
        {size === 'confirm'
          ? `${verb} this transaction?`
          : multiSelect
            ? 'Select transactions to delete'
            : `${verb} which transaction?`}
      </Text>
      <View style={{ gap: 8 }}>
        {visibleCandidates.map((tx) => (
          <TxOpCandidateRow
            key={tx.id}
            tx={tx}
            accountsById={accountsById}
            categoriesById={categoriesById}
            payeesById={payeesById}
            // On the confirm (1-candidate) card the row is INERT: the explicit
            // Delete/Edit button below is the only way to act. Tapping the row
            // used to fire the same destructive path, which meant the card
            // asked "Delete this transaction?" and then tapping the thing it
            // was asking about answered "yes" — a second, invisible trigger for
            // an irreversible action. Multi-select rows still toggle.
            onPress={
              multiSelect ? () => onToggleSelect(tx.id) : size === 'confirm' ? undefined : () => onPick(tx)
            }
            selectable={multiSelect}
            selected={selectedIds.has(tx.id)}
          />
        ))}
      </View>
      {size === 'sheet' && (
        <Pressable
          onPress={onShowAll}
          className="mt-1 py-2 items-center"
          accessibilityLabel={`Show all ${txOp.candidates.length}`}
        >
          <Text className="text-primary font-bold" style={{ fontSize: s.role.control }}>
            Show all {txOp.candidates.length}
          </Text>
        </Pressable>
      )}
      {/* The same shape as the draft card's Discard · Edit · Save: equal-width
          pills on one row, the way out on the left and the committing action
          on the right. Previously this was a full-width coloured button with
          "Never mind" as a small text link underneath — a different visual
          language for the same kind of decision, and the destructive action
          got the most emphasis on the screen. */}
      <View className="flex-row mt-3" style={{ gap: 10 }}>
        <Button title="Never mind" variant="ghost" onPress={onDismiss} className="flex-1" />
        {size === 'confirm' && (
          <Button
            title={txOp.op === 'delete' ? 'Delete' : 'Edit'}
            variant={txOp.op === 'delete' ? 'destructive' : 'primary'}
            onPress={() => onPick(txOp.candidates[0]!)}
            className="flex-1"
          />
        )}
        {multiSelect && selectedIds.size > 0 && (
          <Button
            title={`Delete ${selectedIds.size}`}
            variant="destructive"
            onPress={onDeleteSelected}
            className="flex-1"
          />
        )}
      </View>
      {busy && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
    </Card>
  );
}

/** ">5" overflow sheet (spec §5.4) — a plain Modal, the SAME proven pattern
 *  AccountPickerSheet already uses, rather than the richer `BottomSheet`
 *  component: BottomSheet stacking a second sheet over this screen's own
 *  KeyboardAvoidingView is flagged as unverified (spec §12 open question 4),
 *  while Modal already renders above everything, including a sheet already
 *  on screen — the conservative, proven choice.
 *
 *  Multi-select delete (§13 amendment): this sheet only ever renders for the
 *  ">5" size, so for `op === 'delete'` every row here is always
 *  multi-select-eligible — same checkbox rows and count-labelled footer
 *  action as the inline card, so a selection made here (or in the inline
 *  top-3) survives switching between the two (selection state is lifted to
 *  the screen, not owned by either component). */
function TxOpShowAllSheet({
  visible,
  txOp,
  accountsById,
  categoriesById,
  payeesById,
  onPick,
  onClose,
  selectedIds,
  onToggleSelect,
  onDeleteSelected,
}: {
  visible: boolean;
  txOp: TxOpState;
  accountsById: Map<string, Account>;
  categoriesById: Map<string, Category>;
  payeesById: Map<string, Payee>;
  onPick: (tx: Transaction) => void;
  onClose: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDeleteSelected: () => void;
}) {
  const c = useThemeColors();
  const multiSelect = txOp.op === 'delete';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/55 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface rounded-t-3xl pt-3 pb-8"
          style={{ maxHeight: '80%' }}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="w-9 h-1.5 rounded-full self-center mb-3" style={{ backgroundColor: c.grabHandle }} />
          <View className="flex-row items-center justify-between px-4 mb-3">
            <Pressable
              hitSlop={6}
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-surfaceAlt items-center justify-center"
              accessibilityLabel="Close"
            >
              <Feather name="x" size={16} color={c.muted} />
            </Pressable>
            <Text className="text-text text-base font-extrabold">
              All matching transactions
            </Text>
            <View className="w-8 h-8" />
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
          >
            {txOp.candidates.map((tx) => (
              <TxOpCandidateRow
                key={tx.id}
                tx={tx}
                accountsById={accountsById}
                categoriesById={categoriesById}
                payeesById={payeesById}
                onPress={
                  multiSelect
                    ? () => onToggleSelect(tx.id)
                    : () => {
                        onClose();
                        onPick(tx);
                      }
                }
                selectable={multiSelect}
                selected={selectedIds.has(tx.id)}
              />
            ))}
          </ScrollView>
          {multiSelect && selectedIds.size > 0 && (
            <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
              {/* Full width here on purpose — this is a sheet footer, not the
                  confirmation card's action row. Same component and tone. */}
              <Button
                title={`Delete ${selectedIds.size} transaction${selectedIds.size === 1 ? '' : 's'}`}
                variant="destructive"
                onPress={() => {
                  onClose();
                  onDeleteSelected();
                }}
              />
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 1 = name, 2 = subtype, 3 = opening/confirm — the 3-question /account Q&A. */
function accountStepNumber(step: AccountFlowState['step']): number {
  switch (step) {
    case 'name':
      return 1;
    case 'subtype':
      return 2;
    default:
      return 3;
  }
}

/** "Step N of 3" + Cancel, shown while the /account Q&A is active. Dots mirror
 *  the step: done = positive, active = primary, pending = surfaceAlt. */
function AccountFlowProgress({
  step,
  onCancel,
}: {
  step: AccountFlowState['step'];
  onCancel: () => void;
}) {
  const s = useScaledType();
  const current = accountStepNumber(step);
  return (
    <View className="flex-row items-center justify-center mb-3" style={{ gap: 10 }}>
      <View className="flex-row items-center" style={{ gap: 5 }}>
        {[1, 2, 3].map((n) => (
          <View
            key={n}
            className={`rounded-pill ${
              n < current ? 'bg-positive' : n === current ? 'bg-primary' : 'bg-surfaceAlt'
            }`}
            style={{ width: s.dot, height: s.dot }}
          />
        ))}
      </View>
      <Text className="text-muted font-semibold" style={{ fontSize: s.role.caption }}>
        Step {current} of 3
      </Text>
      <Pressable onPress={onCancel} accessibilityLabel="Cancel account setup">
        <Text className="text-negative font-bold" style={{ fontSize: s.role.caption }}>
          Cancel
        </Text>
      </Pressable>
    </View>
  );
}

/** Tap-don't-type choices for the /account Q&A's "subtype" question. Each tap
 *  funnels through `onChoose` → the same advanceAccountFlow() a typed answer
 *  uses, so a chip and free-typed text land on identical state. */
function SubtypeChoiceChips({ onChoose }: { onChoose: (answer: string) => void }) {
  const s = useScaledType();
  return (
    <View className="flex-row flex-wrap justify-center mt-5" style={{ gap: 10 }}>
      {ACCOUNT_SUBTYPE_CHOICES.map((choice) => (
        <Pressable
          key={choice.value}
          onPress={() => onChoose(choice.label)}
          accessibilityLabel={`Choose ${choice.label}`}
          className="rounded-pill bg-surfaceAlt items-center justify-center"
          style={{ minHeight: s.chipHeight, paddingHorizontal: 20 }}
        >
          <Text className="text-text font-semibold" style={{ fontSize: s.role.control }}>
            {choice.label}
          </Text>
        </Pressable>
      ))}
      <Pressable
        onPress={() => onChoose('skip')}
        accessibilityLabel="Skip account type"
        className="rounded-pill bg-surfaceAlt items-center justify-center"
        style={{ minHeight: s.chipHeight, paddingHorizontal: 20 }}
      >
        <Text className="text-muted font-semibold" style={{ fontSize: s.role.control }}>
          Skip
        </Text>
      </Pressable>
    </View>
  );
}

/** Quick-action chips on the idle hero — shortcuts into the same domain
 *  entry points ("/account", onScan, the slash menu) the typed path uses. */
function QuickActionChips({
  onNewAccount,
  onScanReceipt,
  onAllCommands,
  c,
  s,
}: {
  onNewAccount: () => void;
  onScanReceipt: (at?: { x: number; y: number } | null) => void;
  onAllCommands: () => void;
  c: ReturnType<typeof useThemeColors>;
  s: ReturnType<typeof useScaledType>;
}) {
  return (
    <View className="flex-row flex-wrap justify-center mt-5" style={{ gap: 8 }}>
      <Pressable
        onPress={onNewAccount}
        accessibilityLabel="New account"
        className="flex-row items-center justify-center rounded-pill bg-surfaceAlt"
        style={{ minHeight: s.quickChipHeight, paddingHorizontal: 18, gap: 6 }}
      >
        <Feather name={icons.add} color={c.text} size={15} />
        <Text className="text-text font-semibold" style={{ fontSize: s.role.control }}>
          New account
        </Text>
      </Pressable>
      <Pressable
        onPress={(e) => onScanReceipt({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
        accessibilityLabel="Scan receipt"
        className="flex-row items-center justify-center rounded-pill bg-surfaceAlt"
        style={{ minHeight: s.quickChipHeight, paddingHorizontal: 18, gap: 6 }}
      >
        <Feather name={icons.camera} color={c.text} size={15} />
        <Text className="text-text font-semibold" style={{ fontSize: s.role.control }}>
          Scan receipt
        </Text>
      </Pressable>
      <Pressable
        onPress={onAllCommands}
        accessibilityLabel="All commands"
        className="flex-row items-center justify-center rounded-pill bg-surfaceAlt"
        style={{ minHeight: s.quickChipHeight, paddingHorizontal: 18, gap: 6 }}
      >
        <Feather name={icons.transactions} color={c.text} size={15} />
        <Text className="text-text font-semibold" style={{ fontSize: s.role.control }}>
          All commands
        </Text>
      </Pressable>
    </View>
  );
}

/** Popover listing commands matching the field's leading "/" text, plus a
 *  pinned "What can I ask?" row (unrelated to the "/" filter, so it stays
 *  visible even when `items` is empty — e.g. a typed "/x" that matches no
 *  command) opening AssistantExamplesSheet. Rendered as a sibling of the
 *  input bar (not the scroll view) so it rides with the bar above the
 *  keyboard instead of scrolling away with the rest of the screen. */
function SlashMenu({
  items,
  onPick,
  onExamples,
}: {
  items: AssistantCommand[];
  onPick: (cmd: AssistantCommand) => void;
  onExamples: () => void;
}) {
  const c = useThemeColors();
  return (
    <View
      className="absolute left-0 right-0 bg-surface border border-border rounded-md overflow-hidden"
      style={{ bottom: '100%', marginBottom: 8 }}
    >
      {items.map((cmd, i) => (
        <Pressable
          key={cmd.name}
          onPress={() => onPick(cmd)}
          accessibilityLabel={`Run ${cmd.name}`}
          className={`px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
        >
          <Text className="text-text text-sm font-bold">{cmd.name}</Text>
          <Text className="text-muted text-xs mt-0.5">{cmd.title}</Text>
        </Pressable>
      ))}
      <Pressable
        onPress={onExamples}
        accessibilityLabel="What can I ask"
        className={`px-4 py-3 flex-row items-center justify-between ${items.length > 0 ? 'border-t border-border' : ''}`}
      >
        <View>
          <Text className="text-text text-sm font-bold">What can I ask?</Text>
          <Text className="text-muted text-xs mt-0.5">See examples — expenses, questions, accounts</Text>
        </View>
        <Feather name="chevron-right" size={16} color={c.muted} />
      </Pressable>
    </View>
  );
}
