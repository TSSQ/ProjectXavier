import { View, Text, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { RowSnippet } from '../ui/RowSnippet';
import { Button } from '../ui/Button';
import { useThemeColors } from '../../theme/useThemeColors';
import { TransactionDraft } from '../../domain/assistant';
import { Badge } from '../ui/Badge';
import { normalizeName } from '../../domain/payees';
import { formatMoney } from '../../domain/money';
import { dateLabelFor } from '../../domain/dates';
import { Account, Category, Payee } from '../../domain/types';

/** Which engine produced a draft, for an honest source pill on the confirm
 *  card: 'on_device' = Apple Foundation Models (the default AI tier),
 *  'heuristic' = the deterministic offline floor, 'openai'/'anthropic' = a
 *  BYOK cloud provider (docs/design/byok-spec.md — only ever set when the
 *  user opted in and supplied their own key), 'layout' = the statement-scan
 *  path (docs/design/statement-scan-spec.md §4.4 point 6) — every field
 *  read straight off the screenshot's geometry, no model in the loop.
 *  Module-scope (not declared inside AssistantScreen) so DraftCard's props
 *  can share the exact same type instead of a second, separately-maintained
 *  union. */
export type ParseSource = 'on_device' | 'heuristic' | 'heuristic_fallback' | 'openai' | 'anthropic' | 'layout';

/** "Cash Wallet or Travel Wallet" (2 candidates), "Cash Wallet, Travel
 *  Wallet or 2 more" (3+) — `draft.ambiguousAccountNames` (findAccountMatch's
 *  tie, domain/assistant.ts) is unbounded, and while two names read fine
 *  inline, five would just be noise; past two, the tail collapses into a
 *  count instead of listing every candidate. */
function describeAmbiguousAccounts(names: string[]): string {
  if (names.length <= 2) return names.join(' or ');
  const [first, second] = names;
  return `${first}, ${second} or ${names.length - 2} more`;
}

export function DraftCard({
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
  onUseAccountSuggestion,
  onKeepAccount,
  onRevertLearnedCategory,
  onRevertLearnedAccount,
  onReportWrong,
  onSave,
  onDiscard,
  onEdit,
  source,
  aiFallbackFrom,
  cloudFallbackNotice,
  discardLabel,
  sourceImage,
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
  onUseAccountSuggestion: () => void;
  onKeepAccount: () => void;
  /** "Use <engine's proposal> instead" — undo a learned category/account
   *  (domain/learnedDefaults.ts) the card flagged as "as last time". */
  onRevertLearnedCategory: () => void;
  onRevertLearnedAccount: () => void;
  /** "This parse was wrong" (docs/design/parse-correction-loop-spec.md) —
   *  opens the editor with the report flag set, so the corrected fields are
   *  saved to the on-device corrections file. Only passed in diagnostics
   *  builds (METRICS_ENABLED); absent → the link is not rendered. */
  onReportWrong?: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onEdit: () => void;
  /** Which engine produced this draft, for an honest source pill — see the
   *  module-scope ParseSource type. */
  source?: ParseSource | null;
  /** Set with source 'heuristic_fallback': the AI engines that gave nothing. */
  aiFallbackFrom?: string | null;
  /** Set when the user's BYOK provider failed and a later engine (on-device
   *  or basic) served this draft: the one-line, key-free notice from
   *  src/domain/cloudParseTransport.ts's `cloudFallbackNotice` ("Your OpenAI
   *  key didn't answer (invalid key); parsed on-device instead."). Takes the
   *  place of the generic `aiFallbackFrom` line — a dead key is the thing the
   *  user can actually fix. */
  cloudFallbackNotice?: string | null;
  /** "Skip" while a statement-scan queue is active (spec §4.4 point 5);
   *  "Discard" (the button's own default) everywhere else. */
  discardLabel?: string;
  /** The scanned photo this draft (if any) was read from — docs/design/
   *  row-snippet-spec.md §4.3. RowSnippet only ever renders when `draft.
   *  sourceBand`, `draft.sourceAmountBand` and this are ALL set (one guard,
   *  every half): a chat-parsed draft has no band, and a fresh scan/message
   *  clears this alongside the rest of the draft state, so they can never
   *  point at different photos. */
  sourceImage?: { uri: string; width: number; height: number } | null;
}) {
  const c = useThemeColors();
  const isTransfer = draft.type === 'transfer';
  const accountName =
    accounts.find((a) => a.id === draft.accountId)?.name ?? 'Account';
  // The account the engine (or the default) had chosen before the payee's
  // remembered one replaced it — for the "Use <X> instead" revert.
  const engineAccountName = draft.learnedAccount
    ? (accounts.find((a) => a.id === draft.learnedAccount!.engineAccountId)?.name ?? 'the default account')
    : null;
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
          {draft.pending && <Badge label="Pending" tone="muted" />}
        </View>
        {source === 'heuristic' || source === 'heuristic_fallback' ? (
          // "Basic", not "Offline": it is the no-AI parser, and it runs on a
          // perfectly online phone whenever the AI engines give nothing.
          <Badge label="Basic" tone="muted" />
        ) : source === 'on_device' ? (
          <Badge label="On-device" tone="primary" />
        ) : source === 'openai' ? (
          <Badge label="OpenAI" tone="primary" />
        ) : source === 'anthropic' ? (
          <Badge label="Anthropic" tone="primary" />
        ) : source === 'layout' ? (
          <Badge label="From screenshot" tone="primary" />
        ) : (
          <Badge label="AI parsed" tone="primary" />
        )}
      </View>
      {cloudFallbackNotice ? (
        <Text className="text-[11px] text-muted mb-2 -mt-1">{cloudFallbackNotice}</Text>
      ) : source === 'heuristic_fallback' && aiFallbackFrom ? (
        <Text className="text-[11px] text-muted mb-2 -mt-1">
          {aiFallbackFrom} didn't answer, so this used basic parsing — check it before saving.
        </Text>
      ) : null}
      {draft.sourceBand && draft.sourceAmountBand && sourceImage ? (
        <RowSnippet
          band={draft.sourceBand}
          amountBand={draft.sourceAmountBand}
          image={sourceImage}
        />
      ) : null}
      <Field k="Amount" v={signed} valueClassName={tone} />
      {draft.amountFromTotal ? (
        <Text className="text-[11px] text-muted mb-1 -mt-1">
          Amount taken from the receipt's TOTAL line.
        </Text>
      ) : null}
      {draft.amountFromRow ? (
        <Text className="text-[11px] text-muted mb-1 -mt-1">
          Amount read straight from the photo.
        </Text>
      ) : null}
      {draft.mismatchedCurrency ? (
        <Text className="text-[11px] text-negative mb-1 -mt-1">
          {source === 'layout'
            ? 'This row is in'
            : draft.amountFromRow
              ? 'The photo shows'
              : 'Heard'}{' '}
          "{draft.mismatchedCurrency}"
          — this account is in {draft.currency}. Tap Edit to enter the amount in{' '}
          {draft.currency}.
        </Text>
      ) : null}
      {draft.duplicateOf ? (
        <Text className="text-[11px] text-amber mb-1 -mt-1">
          Looks like a duplicate — {draft.duplicateOf.label} is already on the ledger.
        </Text>
      ) : null}
      {draft.transferHint && draft.type !== 'transfer' ? (
        <Text className="text-[11px] text-amber mb-1 -mt-1">
          Looks like a transfer — Edit to pick the account.
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
      {draft.unmatchedAccountName && !draft.accountSuggestion ? (
        <Text className="text-[11px] text-negative mb-1 -mt-1">
          "{draft.unmatchedAccountName}" not found — using {accountName}
        </Text>
      ) : draft.ambiguousAccountNames?.length ? (
        // Distinct from `unmatchedAccountName` above (and mutually exclusive
        // with it by construction — see interpret()'s own ternary,
        // domain/assistant.ts): this means the name matched SEVERAL accounts,
        // not none, so the copy says what was picked AND that it was a
        // guess, rather than implying nothing was found.
        <Text className="text-[11px] text-negative mb-1 -mt-1">
          Could mean {describeAmbiguousAccounts(draft.ambiguousAccountNames)} — using{' '}
          {accountName}
        </Text>
      ) : draft.looseAccountMatchText ? (
        // Also mutually exclusive with the two above by construction (set
        // only when the account DID resolve — domain/assistant.ts's own
        // ternary) — a containment/subtype-cue match is used exactly like a
        // verbatim name, but wasn't one, so this says so without alarming
        // the user the way the negative-toned warnings above do (QA build-99
        // MAJOR: a match like this had no card affordance at all before).
        <Text className="text-[11px] text-muted mb-1 -mt-1">
          Matched "{draft.looseAccountMatchText}" to this account.
        </Text>
      ) : draft.learnedAccount && engineAccountName ? (
        // The engine named no account, so the payee's last-confirmed one was
        // used (domain/learnedDefaults.ts) — said plainly, with the engine's
        // own fallback one tap away. Mutually exclusive with the three above
        // by construction: applyLearnedAccount never fires when any of them
        // is set.
        <LearnedNote
          label={`Using ${accountName} as last time.`}
          revertLabel={`Use ${engineAccountName} instead`}
          onRevert={onRevertLearnedAccount}
        />
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
          {draft.learnedCategory && draft.categoryName ? (
            // The payee's remembered category replaced the engine's proposal
            // (domain/learnedDefaults.ts) — the proposal stays one tap away.
            // A null proposal means the engine offered nothing, so the
            // revert just clears the field back to "Add".
            <LearnedNote
              label={`Using ${draft.categoryName} as last time.`}
              revertLabel={
                draft.learnedCategory.engineCategoryName
                  ? `Use ${draft.learnedCategory.engineCategoryName} instead`
                  : 'Clear it'
              }
              onRevert={onRevertLearnedCategory}
            />
          ) : null}
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

      {/* `wellRecessed` (not `surface`, S7 QA round-1 fix): this Card is
          already `bg-surface`, so a `bg-surface` callout nested inside it
          was flush with its own container in every theme, not just dark —
          only the border hairline showed. `wellRecessed` is the ladder's
          "content sits inset inside this" rung, which is what this recessed,
          action-holding callout is; both suggestion callouts below share it. */}
      {draft.accountSuggestion ? (
        // Same shape as the payee callout below. The account row above still
        // shows where the draft is filed until the user chooses — this is an
        // offer, never an automatic switch (domain/accountMatch.ts's
        // findAccountMentionInText explains why it can't be).
        <View className="mt-3 rounded-md border border-primary bg-wellRecessed p-3">
          <Text className="text-text text-[13px]">
            Did you mean <Text className="font-bold">{draft.accountSuggestion.name}</Text>?
          </Text>
          <View className="flex-row mt-2.5" style={{ gap: 8 }}>
            <Button
              title={`Keep ${accountName}`}
              variant="ghost"
              onPress={onKeepAccount}
              className="flex-1"
            />
            <Button
              title={`Use ${draft.accountSuggestion.name}`}
              variant="primary"
              onPress={onUseAccountSuggestion}
              className="flex-1"
            />
          </View>
        </View>
      ) : null}

      {suggestion && draft.payeeName ? (
        <View className="mt-3 rounded-md border border-primary bg-wellRecessed p-3">
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
        <View className="mt-3 rounded-md border border-primary bg-wellRecessed p-3">
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
        <Button title={discardLabel ?? 'Discard'} variant="ghost" onPress={onDiscard} className="flex-1" />
        <Button title="Edit" variant="ghost" onPress={onEdit} className="flex-1" />
        <Button title="Save" variant="primary" onPress={onSave} className="flex-1" />
      </View>
      {onReportWrong && draft.sourceText ? (
        // Diagnostics builds only. A correction needs the user's own words
        // (`sourceText`) to be an eval case, so a draft without them (a
        // statement-scan row) has no link.
        <Pressable
          onPress={onReportWrong}
          accessibilityRole="button"
          accessibilityLabel="This parse was wrong"
          className="self-center mt-2.5"
          hitSlop={6}
        >
          <Text className="text-[11px] text-muted underline">This parse was wrong — fix it and keep a copy for the eval set</Text>
        </Pressable>
      ) : null}
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
        {badge ? <Badge label={badge} tone="primary" /> : null}
      </View>
    </View>
  );
}

/** "Using Food as last time." + a one-tap revert to what the engine
 *  proposed — the affordance for a learned payee default
 *  (domain/learnedDefaults.ts). Muted, not amber: this is the user's own
 *  past choice, not a guess that needs checking. */
function LearnedNote({
  label,
  revertLabel,
  onRevert,
}: {
  label: string;
  revertLabel: string;
  onRevert: () => void;
}) {
  return (
    <View className="flex-row items-center flex-wrap mb-1 -mt-1" style={{ gap: 6 }}>
      <Text className="text-[11px] text-muted">{label}</Text>
      <Pressable
        onPress={onRevert}
        accessibilityRole="button"
        accessibilityLabel={revertLabel}
        hitSlop={6}
      >
        <Text className="text-[11px] text-primary font-semibold">{revertLabel}</Text>
      </Pressable>
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

export function dateLabel(ms: number): string {
  return dateLabelFor(ms, Date.now());
}
