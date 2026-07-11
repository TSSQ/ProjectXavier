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
  ActionSheetIOS,
  Platform,
} from 'react-native';
// Keyboard-controller's KeyboardAvoidingView is driven frame-for-frame by the
// native keyboard animation (unlike RN's, which desyncs and briefly reveals the
// window background — the white flash). Requires the root KeyboardProvider.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { AssistantAvatar } from '../../src/components/AssistantAvatar';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { icons } from '../../src/theme/assets';
import { useThemeColors } from '../../src/theme/useThemeColors';
import { saveAssistantDraft } from '../../src/features/ai/saveDraft';
import { listAccounts, createAccount } from '../../src/features/accounts/repository';
import { listCategories } from '../../src/features/categories/repository';
import { listPayees } from '../../src/features/payees/repository';
import { getCurrency } from '../../src/features/settings/repository';
import { interpret, TransactionDraft } from '../../src/domain/assistant';
import {
  isAccountCommand,
  transactionCommandBody,
  startAccountFlow,
  advanceAccountFlow,
  ACCOUNT_SUBTYPE_CHOICES,
  AccountFlowState,
  ReadyAccount,
} from '../../src/domain/accountAssistant';
import {
  matchCommands,
  isSlashQuery,
  AssistantCommand,
} from '../../src/domain/assistantCommands';
import { localParse } from '../../src/domain/localParse';
import { isDeviceAiAvailable, deviceParse } from '../../src/features/ai/deviceParse';
import { isUsefulDeviceParse } from '../../src/domain/deviceParsePrompt';
import { aiParsedExpenseSchema } from '../../src/lib/validation';
import { findPayeeMatch, normalizeName } from '../../src/domain/payees';
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
import { formatDMY, isSameDay } from '../../src/domain/dates';
import { Account, Category, Payee } from '../../src/domain/types';
import {
  TransactionFormSheet,
  FormValues,
} from '../../src/components/transactions/TransactionFormSheet';
import { avatarStateFor, AssistantOutcomeKind } from '../../src/domain/avatar';

const GREETING = "Hi, I'm Xavier. Tell me about an expense, or snap a receipt.";

export default function AssistantScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
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
  const [appCurrency, setAppCurrency] = useState('USD');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  // A close-but-not-exact existing payee to offer as "did you mean…?".
  const [suggestion, setSuggestion] = useState<Payee | null>(null);
  // Same idea, for the category (same-kind exact/fuzzy match only).
  const [categorySuggestion, setCategorySuggestion] = useState<Category | null>(null);
  // Which engine produced the current draft, so the card can label it honestly:
  // 'on_device' = Apple Foundation Models (the default), 'heuristic' = the
  // deterministic offline floor. null when there's no draft.
  type ParseSource = 'on_device' | 'heuristic';
  const [parseSource, setParseSource] = useState<ParseSource | null>(null);
  const [busy, setBusy] = useState(false);
  // Last transient outcome, for the avatar's reaction.
  const [lastOutcome, setLastOutcome] = useState<AssistantOutcomeKind>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  // Diagnostics: the current parse's metric id, and whether the user took the
  // payee suggestion, so the confirm step can record how the parse resolved.
  const parseIdRef = useRef<string | null>(null);
  const payeeSwappedRef = useRef(false);
  // Lets a quick-action chip / slash-menu tap re-focus the text field so the
  // keyboard comes up the same way it would if the user had tapped in.
  const inputRef = useRef<TextInput>(null);
  // Guards against re-firing the widget deep links on every re-render/tab
  // switch — expo-router keeps the last params around, but each of these
  // must only run once per navigation (same idiom as app/debug-fm.tsx's
  // `autoran` ref for its own deep-link param).
  const focusDeepLinkHandledRef = useRef(false);
  const scanDeepLinkHandledRef = useRef(false);

  const avatarState = avatarStateFor({
    busy,
    typing: draft.trim().length > 0,
    lastOutcome,
  });

  // Shared idle-gate for both "extra surfaces" — the quick-action chips and
  // the slash popover. Neither may render while a draft card, account draft,
  // or the /account Q&A owns the screen: they'd sit in/over the same region
  // as the confirm card and could intercept its Create/Discard taps.
  const noOverlay = !pending && !pendingAccount && !accountFlow;
  // Idle hero: also not busy. Chips hide the moment any of those become true.
  const showQuickActions = noOverlay && !busy;

  // Slash-command popover: derived from the field text (so the chip shortcut
  // and typed "/" stay in lockstep, see src/domain/assistantCommands.ts), but
  // only while `noOverlay` — same idle-gate as the quick-action chips above.
  const slashItems = noOverlay && isSlashQuery(draft) ? matchCommands(draft) : [];

  // The field doubles as the /account Q&A's answer box, so its placeholder
  // should match what's being asked instead of always describing an expense.
  const inputPlaceholder = !accountFlow
    ? 'Describe an expense…'
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

  // Load accounts, categories, and payees; no feed list.
  // Runs on focus so data from other tabs shows up too.
  const loadContext = useCallback(async () => {
    const [accts, cats, pays] = await Promise.all([
      listAccounts(),
      listCategories(),
      listPayees(),
    ]);
    setAccounts(accts);
    setCategories(cats);
    setPayees(pays);
    setAppCurrency(await getCurrency());
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadContext();
    }, [loadContext])
  );

  async function runParse(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setPending(null);
    setSuggestion(null);
    setCategorySuggestion(null);
    setParseSource(null);
    setLastOutcome(null);
    setEditorOpen(false);
    setEditorError(null);
    parseIdRef.current = null;
    payeeSwappedRef.current = false;
    const trimmed = text.trim();
    const startedAt = Date.now();
    // Hoisted so the heuristic fallback and catch-block reuse the same
    // grounding data and clock as the FM attempt.
    let accts: Account[] = [];
    let cats: Category[] = [];
    let pays: Payee[] = [];
    let now = startedAt;
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
      const fm = await deviceParse(trimmed, { categories: cats, payees: pays, accounts: accts, now });
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

    // Heuristic floor — deterministic on-device parse (no model, no network).
    // The last resort when FM is unavailable or couldn't produce a usable
    // parse. Returns false only when its own output fails validation, so the
    // caller can show a generic error instead of building a draft from
    // untrusted/malformed data.
    async function runHeuristicParse(): Promise<boolean> {
      const localParsed = localParse(trimmed, { categories: cats, payees: pays, now });
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
      // Computed once and reused by every recordParse call below (both the
      // on_device tier and the heuristic floor) so the metric captures
      // whether Foundation Models were even an option for this parse.
      deviceAiCapable = await isDeviceAiAvailable();

      // FM-first: Apple Foundation Models is the only AI engine — private,
      // on-device, no network. When it produces a usable parse we're done.
      if (await runFmParse()) return;

      // FM unavailable or couldn't parse the input: fall to the deterministic
      // heuristic floor — still fully on-device, no network involved.
      const handled = await runHeuristicParse();
      if (!handled) {
        setReply(
          'I couldn\'t parse that. Try "/transactions lunch 12.50", or add it manually below.'
        );
        setLastOutcome('error');
      }
    } catch (e) {
      // Unexpected failure in the on-device parse path (FM session error,
      // local DB read, etc.) — surface it rather than leaving the user stuck.
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.warn('parse failed:', e);
      setReply(`Couldn't parse that — ${msg}`);
      setLastOutcome('error');
      void recordParse({
        engine: deviceAiCapable ? 'on_device' : 'heuristic',
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
    const res = startAccountFlow();
    setAccountFlow(res.state);
    setReply(res.message);
  };

  // Advance the /account Q&A with `answer` — shared by the typed reply
  // (onSend, mid-flow) and the tap-don't-type subtype chips, so a chip and a
  // typed answer land on identical state via the same advanceAccountFlow call.
  const answerAccountFlow = (answer: string) => {
    if (!accountFlow) return;
    const res = advanceAccountFlow(accountFlow, answer);
    setAccountFlow(res.state);
    setReply(res.message);
    if (res.ready) setPendingAccount(res.ready);
  };

  const onSend = async () => {
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
    const txBody = transactionCommandBody(t);
    if (txBody === '') {
      setReply("Sure — what's the transaction?");
      return;
    }
    await runParse(txBody ?? text);
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
    setPendingAccount(null);
    setAccountFlow(null);
    setReply('No problem — cancelled. What else?');
  };

  const onConfirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    const pendingType = pending.type;
    try {
      const txId = await saveAssistantDraft(pending);
      void resolveParse(parseIdRef.current, {
        resolved: 'saved',
        txId,
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
      const txId = await saveAssistantDraft(edited);
      void resolveParse(parseIdRef.current, { resolved: 'edited', txId, payeeSwapped: payeeSwappedRef.current });
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

  const onScan = () => {
    if (busy) return;
    // Camera or an already-taken photo (screenshots of e-receipts included).
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Take photo', 'Choose from library', 'Cancel'],
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) void captureReceipt();
        else if (index === 1) void pickReceipt();
      }
    );
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
          className="w-11 h-11 rounded-pill bg-surfaceAlt items-center justify-center"
          onPress={onScan}
          accessibilityLabel="Scan receipt"
        >
          <Feather name={icons.camera} color={c.text} size={20} />
        </Pressable>
        <TextInput
          ref={inputRef}
          className="flex-1 bg-surface text-text rounded-pill px-4 py-3 text-base"
          // text-base carries lineHeight 24, which iOS TextInputs mis-center,
          // clipping descenders at the bottom — override like ui/Input.tsx.
          style={{ letterSpacing: 0, lineHeight: 20 }}
          value={draft}
          onChangeText={setDraft}
          placeholder={inputPlaceholder}
          placeholderTextColor={c.muted}
          onSubmitEditing={onSend}
          returnKeyType="send"
          editable={!busy}
        />
        <Pressable
          className="w-11 h-11 rounded-pill bg-primary items-center justify-center"
          onPress={onSend}
          accessibilityLabel="Send"
        >
          <Feather name={icons.send} color="#fff" size={20} />
        </Pressable>
      </View>
      <Link
        href="/transactions"
        style={{ color: c.muted, textAlign: 'center', marginTop: 12, fontSize: 13 }}
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
      <View className="flex-1 bg-bg px-5 pb-4" style={{ paddingTop: insets.top + 8 }}>
        {/* Centered content column — plain ScrollView guards against keyboard
            overlap when the DraftCard is visible. */}
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Vertically centered hero area */}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 340 }}>
            {/* Step N of 3 + Cancel while the /account Q&A is active (hidden
                once the confirm card takes over — that card owns Discard). */}
            {accountFlow && !pendingAccount && (
              <AccountFlowProgress step={accountFlow.step} onCancel={onDiscardAccount} />
            )}
            {/* Shrink Xavier mid-Q&A so the progress line + question + chips
                read as one compact group instead of floating around a
                hero-sized face; no animation — just swap the size prop. */}
            <AssistantAvatar
              size={accountFlow ? 96 : 160}
              state={avatarState}
            />
            <Text className="text-text text-center text-base font-bold mt-6 px-4">
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

          {/* Account confirm card (from the /account Q&A) */}
          {pendingAccount && (
            <View style={{ paddingBottom: 8 }}>
              <AccountDraftCard
                account={pendingAccount}
                currency={appCurrency}
                onCreate={onCreateAccount}
                onDiscard={onDiscardAccount}
              />
              {busy && <ActivityIndicator color={c.primary} style={{ marginTop: 8 }} />}
            </View>
          )}
        </ScrollView>

        {/* Input bar always pinned at the bottom. Wrapped in a `relative`
            container so the slash-command popover — a sibling of the bar, not
            the scroll view — rides with it above the keyboard instead of
            scrolling away. */}
        <View style={{ position: 'relative' }}>
          {slashItems.length > 0 && (
            <SlashMenu items={slashItems} onPick={runSlashCommand} />
          )}
          {inputBar}
        </View>

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
            initial={editorInitial}
            onSave={onEditSave}
            busy={busy}
            error={editorError}
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
  /** Which engine produced this draft, for an honest source pill:
   *  'on_device' (Apple Foundation Models, the default) or 'heuristic'
   *  (deterministic offline floor). */
  source?: 'on_device' | 'heuristic' | null;
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
        ) : (
          <Text className="text-primary text-[11px] font-bold border border-borderAccent rounded-pill px-2 py-0.5">
            AI parsed
          </Text>
        )}
      </View>
      <Field k="Amount" v={signed} valueClassName={tone} />
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

/** Confirm card for an account collected via the /account Q&A flow. */
function AccountDraftCard({
  account,
  currency,
  onCreate,
  onDiscard,
}: {
  account: ReadyAccount;
  currency: string;
  onCreate: () => void;
  onDiscard: () => void;
}) {
  const balTone = account.openingBalance < 0 ? 'text-negative' : 'text-text';
  return (
    <Card className="border-borderAccent self-stretch">
      <View className="flex-row items-center justify-between mb-2.5">
        <Text className="text-text text-sm font-bold">New account</Text>
        <Text className="text-primary text-[11px] font-bold border border-borderAccent rounded-pill px-2 py-0.5">
          Assistant
        </Text>
      </View>
      <Field k="Name" v={account.name} />
      <Field k="Type" v={account.subtype ? account.subtype.replace(/_/g, ' ') : '—'} />
      <Field k="Currency" v={currency} />
      <Field
        k="Starting balance"
        v={formatMoney(account.openingBalance, currency)}
        valueClassName={balTone}
      />
      <View className="flex-row mt-3" style={{ gap: 10 }}>
        <Button title="Discard" variant="ghost" onPress={onDiscard} className="flex-1" />
        <Button title="Create" variant="primary" onPress={onCreate} className="flex-1" />
      </View>
    </Card>
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
  const current = accountStepNumber(step);
  return (
    <View className="flex-row items-center justify-center mb-3" style={{ gap: 10 }}>
      <View className="flex-row items-center" style={{ gap: 5 }}>
        {[1, 2, 3].map((n) => (
          <View
            key={n}
            className={`w-2 h-2 rounded-pill ${
              n < current ? 'bg-positive' : n === current ? 'bg-primary' : 'bg-surfaceAlt'
            }`}
          />
        ))}
      </View>
      <Text className="text-muted text-xs font-semibold">Step {current} of 3</Text>
      <Pressable onPress={onCancel} accessibilityLabel="Cancel account setup">
        <Text className="text-negative text-xs font-bold">Cancel</Text>
      </Pressable>
    </View>
  );
}

/** Tap-don't-type choices for the /account Q&A's "subtype" question. Each tap
 *  funnels through `onChoose` → the same advanceAccountFlow() a typed answer
 *  uses, so a chip and free-typed text land on identical state. */
function SubtypeChoiceChips({ onChoose }: { onChoose: (answer: string) => void }) {
  return (
    <View className="flex-row flex-wrap justify-center mt-5" style={{ gap: 8 }}>
      {ACCOUNT_SUBTYPE_CHOICES.map((choice) => (
        <Pressable
          key={choice.value}
          onPress={() => onChoose(choice.label)}
          accessibilityLabel={`Choose ${choice.label}`}
          className="rounded-pill bg-surfaceAlt px-4 py-2"
        >
          <Text className="text-text text-[13px] font-semibold">{choice.label}</Text>
        </Pressable>
      ))}
      <Pressable
        onPress={() => onChoose('skip')}
        accessibilityLabel="Skip account type"
        className="rounded-pill bg-surfaceAlt px-4 py-2"
      >
        <Text className="text-muted text-[13px] font-semibold">Skip</Text>
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
}: {
  onNewAccount: () => void;
  onScanReceipt: () => void;
  onAllCommands: () => void;
  c: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View className="flex-row flex-wrap justify-center mt-5" style={{ gap: 8 }}>
      <Pressable
        onPress={onNewAccount}
        accessibilityLabel="New account"
        className="flex-row items-center rounded-pill bg-surfaceAlt px-4 py-2"
        style={{ gap: 6 }}
      >
        <Feather name={icons.add} color={c.text} size={15} />
        <Text className="text-text text-[13px] font-semibold">New account</Text>
      </Pressable>
      <Pressable
        onPress={onScanReceipt}
        accessibilityLabel="Scan receipt"
        className="flex-row items-center rounded-pill bg-surfaceAlt px-4 py-2"
        style={{ gap: 6 }}
      >
        <Feather name={icons.camera} color={c.text} size={15} />
        <Text className="text-text text-[13px] font-semibold">Scan receipt</Text>
      </Pressable>
      <Pressable
        onPress={onAllCommands}
        accessibilityLabel="All commands"
        className="flex-row items-center rounded-pill bg-surfaceAlt px-4 py-2"
        style={{ gap: 6 }}
      >
        <Feather name={icons.transactions} color={c.text} size={15} />
        <Text className="text-text text-[13px] font-semibold">All commands</Text>
      </Pressable>
    </View>
  );
}

/** Popover listing commands matching the field's leading "/" text. Rendered as
 *  a sibling of the input bar (not the scroll view) so it rides with the bar
 *  above the keyboard instead of scrolling away with the rest of the screen. */
function SlashMenu({
  items,
  onPick,
}: {
  items: AssistantCommand[];
  onPick: (cmd: AssistantCommand) => void;
}) {
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
    </View>
  );
}
