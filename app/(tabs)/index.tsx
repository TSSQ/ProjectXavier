/**
 * Assistant home — the assistant avatar is the centerpiece. The user describes
 * an expense ("12 bucks lunch at Joe's") or snaps a receipt; the AI proxy
 * parses it, the pure assistant logic decides whether to save / ask / block,
 * and confirmed entries are saved. The chat feed has been removed — the avatar
 * stays hero-sized and vertically centered at all times.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
// Keyboard-controller's KeyboardAvoidingView is driven frame-for-frame by the
// native keyboard animation (unlike RN's, which desyncs and briefly reveals the
// window background — the white flash). Requires the root KeyboardProvider.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { Link, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { AssistantAvatar } from '../../src/components/AssistantAvatar';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { icons } from '../../src/theme/assets';
import { parseExpense } from '../../src/features/ai/client';
import { saveAssistantDraft } from '../../src/features/ai/saveDraft';
import { listAccounts } from '../../src/features/accounts/repository';
import { listCategories } from '../../src/features/categories/repository';
import { listPayees } from '../../src/features/payees/repository';
import { interpret, TransactionDraft } from '../../src/domain/assistant';
import { findPayeeMatch, normalizeName } from '../../src/domain/payees';
import { findCategoryMatch } from '../../src/domain/categories';
import { confidenceBucket, inputLenBucket } from '../../src/domain/parseMetrics';
import {
  recordParse,
  resolveParse,
  ParseOutcome,
} from '../../src/features/diagnostics/parseMetrics';
import { unconfiguredRecognizer } from '../../src/features/ocr/recognizer';
import { getAccessToken } from '../../src/features/auth/repository';
import { formatMoney } from '../../src/domain/money';
import { formatDMY, isSameDay } from '../../src/domain/dates';
import { Account, Category, Payee } from '../../src/domain/types';
import {
  TransactionFormSheet,
  FormValues,
} from '../../src/components/transactions/TransactionFormSheet';
import { avatarStateFor, AssistantOutcomeKind } from '../../src/domain/avatar';

const GREETING = "Hi, I'm Xavier. Tell me about an expense, or snap a receipt.";
// Cap on how many recent payees we hint to the model (cost control).
const MAX_PAYEE_HINTS = 50;

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState(GREETING);
  const [pending, setPending] = useState<TransactionDraft | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  // A close-but-not-exact existing payee to offer as "did you mean…?".
  const [suggestion, setSuggestion] = useState<Payee | null>(null);
  // Same idea, for the category (same-kind exact/fuzzy match only).
  const [categorySuggestion, setCategorySuggestion] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  // Last transient outcome, for the avatar's reaction.
  const [lastOutcome, setLastOutcome] = useState<AssistantOutcomeKind>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  // Diagnostics: the current parse's metric id, and whether the user took the
  // payee suggestion, so the confirm step can record how the parse resolved.
  const parseIdRef = useRef<string | null>(null);
  const payeeSwappedRef = useRef(false);

  const avatarState = avatarStateFor({
    busy,
    typing: draft.trim().length > 0,
    lastOutcome,
  });

  // Stable object identity while the same draft is open — prevents
  // TransactionFormSheet from re-seeding state on every re-render (e.g. when
  // setBusy(true) fires during save). Only changes when `pending` changes.
  const editorInitial = useMemo<FormValues | null>(
    () =>
      pending
        ? {
            accountId: pending.accountId,
            transferAccountId: '',
            type: pending.type,
            amountMinor: pending.amount,
            date: pending.occurredAt,
            categoryName: pending.categoryName ?? '',
            payeeName: pending.payeeName ?? '',
            note: pending.note ?? '',
            repeatRule: null,
            seriesId: null,
            occurrenceDate: null,
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
    setLastOutcome(null);
    setEditorOpen(false);
    setEditorError(null);
    parseIdRef.current = null;
    payeeSwappedRef.current = false;
    const trimmed = text.trim();
    const startedAt = Date.now();
    try {
      const token = await getAccessToken();
      if (!token) {
        setReply('Your session expired — please sign in again.');
        return;
      }
      // Ground the parse in the user's existing data so the model maps to real
      // entities. Payees are capped to keep the prompt cheap as the list grows.
      const [accts, cats, pays] = await Promise.all([
        listAccounts(),
        listCategories(),
        listPayees(),
      ]);
      setAccounts(accts);
      setCategories(cats);
      setPayees(pays);
      const now = Date.now();
      const hintedPayees = pays.slice(0, MAX_PAYEE_HINTS);
      const parsed = await parseExpense(
        {
          text: trimmed,
          categories: cats.map((c) => c.name),
          payees: hintedPayees.map((p) => p.name),
          accounts: accts.filter((a) => !a.archived).map((a) => a.name),
          now,
        },
        token
      );
      const outcome = interpret(parsed, { accounts: accts, now });
      setReply(outcome.message);

      // Diagnostics: record this parse (content-free) so we can later judge
      // whether the local layers would need the cloud (see parse-metrics-spec).
      const metricOutcome: ParseOutcome =
        outcome.kind === 'confirm'
          ? 'confirm'
          : outcome.kind === 'blocked'
            ? 'blocked'
            : outcome.missing.length > 0
              ? 'clarify_missing'
              : 'clarify_lowconf';
      const nullFields = (
        ['amount', 'currency', 'type', 'category', 'payee', 'account', 'occurredAt'] as const
      ).filter((k) => parsed[k] == null);
      parseIdRef.current = await recordParse({
        engine: 'cloud',
        outcome: metricOutcome,
        confidenceBucket: confidenceBucket(parsed.confidence),
        inputLenBucket: inputLenBucket(trimmed.length),
        missingFields: outcome.kind === 'clarify' ? outcome.missing : [],
        nullFields,
        groundingCounts: `cat:${cats.length},pay:${hintedPayees.length},acc:${accts.length}`,
        latencyMs: Date.now() - startedAt,
      });

      if (outcome.kind === 'confirm') {
        // Attach the user's words so they persist on save (sourceText).
        setPending({ ...outcome.draft, sourceText: trimmed });
        // Local fuzzy reconcile (no extra AI call): if the parsed payee is close
        // to one the user already has, offer to merge instead of duplicating.
        if (outcome.draft.payeeName) {
          const { suggestion: near } = findPayeeMatch(
            outcome.draft.payeeName,
            pays
          );
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.warn('parseExpense failed:', e);
      setReply(`Couldn't parse that — ${msg}`);
      setLastOutcome('error');
      void recordParse({
        engine: 'cloud',
        outcome: 'error',
        inputLenBucket: inputLenBucket(trimmed.length),
        latencyMs: Date.now() - startedAt,
      });
    } finally {
      setBusy(false);
    }
  }

  const onSend = async () => {
    const text = draft;
    setDraft('');
    await runParse(text);
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

  // Note: transfer type isn't supported by this path — TransactionDraft has no
  // transferAccountId field. Switching to transfer will fail zod validation in
  // saveAssistantDraft and surface editorError — acceptable fail-safe for now.
  const onEditSave = async (values: FormValues) => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const edited: TransactionDraft = {
        accountId: values.accountId,
        type: values.type,
        amount: values.amountMinor,
        currency: pending.currency,
        categoryName: values.categoryName.trim() || null,
        payeeName: values.payeeName.trim() || null,
        note: values.note.trim() || null,
        occurredAt: values.date,
        source: 'ai',
        sourceText: pending.sourceText ?? null,
      };
      const txId = await saveAssistantDraft(edited);
      void resolveParse(parseIdRef.current, { resolved: 'edited', txId, payeeSwapped: payeeSwappedRef.current });
      parseIdRef.current = null;
      setEditorOpen(false);
      setPending(null);
      setSuggestion(null);
      setCategorySuggestion(null);
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

  const onScan = async () => {
    if (busy) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setReply('I need camera access to scan a receipt.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;
    setBusy(true);
    try {
      // On-device OCR turns the photo into text; only the text hits the proxy.
      const text = await unconfiguredRecognizer.recognize(shot.assets[0].uri);
      await runParse(text);
    } catch {
      setReply('Receipt scanning needs the on-device OCR module (dev build).');
    } finally {
      setBusy(false);
    }
  };

  const inputBar = (
    <>
      <View className="flex-row items-center mt-2" style={{ gap: 8 }}>
        <Pressable
          className="w-11 h-11 rounded-pill bg-surfaceAlt items-center justify-center"
          onPress={onScan}
          accessibilityLabel="Scan receipt"
        >
          <Feather name={icons.camera} color="#F2F5F9" size={20} />
        </Pressable>
        <TextInput
          className="flex-1 bg-surface text-text rounded-pill px-4 py-3 text-base"
          style={{ letterSpacing: 0 }}
          value={draft}
          onChangeText={setDraft}
          placeholder="Describe an expense…"
          placeholderTextColor="#9AA4B2"
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
        style={{ color: '#9AA4B2', textAlign: 'center', marginTop: 12, fontSize: 13 }}
      >
        Prefer to type it in? Add manually
      </Link>
    </>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0E1116' }}
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
            <AssistantAvatar
              size={160}
              state={avatarState}
            />
            <Text className="text-text text-center text-base font-bold mt-6 px-4">
              {reply}
            </Text>
            {busy && !pending && (
              <ActivityIndicator color="#5B8DEF" style={{ marginTop: 12 }} />
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
              />
              {busy && <ActivityIndicator color="#5B8DEF" style={{ marginTop: 8 }} />}
            </View>
          )}
        </ScrollView>

        {/* Input bar always pinned at the bottom */}
        {inputBar}

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
}) {
  const accountName =
    accounts.find((a) => a.id === draft.accountId)?.name ?? 'Account';
  const money = formatMoney(draft.amount, draft.currency);
  const signed = draft.type === 'expense' ? `-${money}` : `+${money}`;
  const tone = draft.type === 'expense' ? 'text-negative' : 'text-positive';

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
    <Card className="border-[#33406e] self-stretch">
      <View className="flex-row items-center justify-between mb-2.5">
        <Text className="text-text text-sm font-bold capitalize">{draft.type}</Text>
        <Text className="text-primary text-[11px] font-bold border border-[#33406e] rounded-pill px-2 py-0.5">
          AI parsed
        </Text>
      </View>
      <Field k="Amount" v={signed} valueClassName={tone} />
      <Field k="Account" v={accountName} />
      {draft.unmatchedAccountName ? (
        <Text className="text-[11px] text-negative mb-1 -mt-1">
          "{draft.unmatchedAccountName}" not found — using {accountName}
        </Text>
      ) : null}
      <Field k="Payee" v={draft.payeeName ?? '—'} badge={payeeIsNew ? 'New' : undefined} />
      <Field
        k="Category"
        v={draft.categoryName ?? '—'}
        badge={categoryIsNew ? 'New' : undefined}
      />
      <Field k="Date" v={dateLabel(draft.occurredAt)} />

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
          <Text className="text-muted text-[10px] font-bold border border-[#33406e] rounded-pill px-1.5 py-0.5">
            {badge}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function dateLabel(ms: number): string {
  return isSameDay(ms, Date.now()) ? 'Today' : formatDMY(ms);
}
