import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useScaledType } from '../../theme/useScaledType';
import { ACCOUNT_SUBTYPE_CHOICES, AccountFlowState, ReadyAccount } from '../../domain/accountAssistant';
import { AccountUpdateDraft } from '../../domain/accountUpdateAssistant';
import { Chip } from '../ui/Chip';

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
export function AccountDraftCard({
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
          className="bg-wellRecessed text-text rounded-md px-3"
          style={{ height: 40, fontSize: s.role.body }}
        />
      </View>

      <View className="py-1.5">
        <Text className="text-muted mb-1" style={{ fontSize: s.role.caption }}>
          Type
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {/* `Chip surface="content"` (QA round 3): this was the pattern in
              all but name — same selected/unselected tokens, same raised
              elevation, same chip height, same pill radius, same semibold
              label, duplicated verbatim in the two draft cards below. */}
          {ACCOUNT_SUBTYPE_CHOICES.map((choice) => {
            const selected = account.subtype === choice.value;
            return (
              <Chip
                key={choice.value}
                label={choice.label}
                selected={selected}
                onPress={() => onChangeSubtype(choice.value)}
                surface="content"
                accessibilityLabel={`Set account type ${choice.label}`}
              />
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
          className={`bg-wellRecessed rounded-md px-3 font-mono font-semibold ${balTone}`}
          style={{ height: 40, fontSize: s.role.body, fontVariant: ['tabular-nums'] }}
        />
      </View>

      <View className="flex-row mt-3" style={{ gap: 10 }}>
        <Button title="Discard" variant="ghost" onPress={onDiscard} accessibilityLabel="Discard account" className="flex-1" />
        <Button title="Create" variant="primary" glow onPress={onCreate} accessibilityLabel="Create account" className="flex-1" />
      </View>
    </Card>
  );
}

/** Confirm card for a chat account UPDATE gate hit (docs/design/account-
 *  chat-crud-spec.md §5.2) — mirrors AccountDraftCard's shape/style exactly,
 *  just for an EXISTING account: name/subtype/balance are all editable
 *  before Confirm, and `updateAccount` only ever runs after that tap. */
export function AccountUpdateDraftCard({
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
          className="bg-wellRecessed text-text rounded-md px-3"
          style={{ height: 40, fontSize: s.role.body }}
        />
      </View>

      <View className="py-1.5">
        <Text className="text-muted mb-1" style={{ fontSize: s.role.caption }}>
          Type
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {/* `Chip surface="content"` (QA round 3) — see the sibling draft
              card above for why. */}
          {ACCOUNT_SUBTYPE_CHOICES.map((choice) => {
            const selected = draft.newSubtype === choice.value;
            return (
              <Chip
                key={choice.value}
                label={choice.label}
                selected={selected}
                onPress={() => onChangeSubtype(choice.value)}
                surface="content"
                accessibilityLabel={`Set account type ${choice.label}`}
              />
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
          className={`bg-wellRecessed rounded-md px-3 font-mono font-semibold ${balTone}`}
          style={{ height: 40, fontSize: s.role.body, fontVariant: ['tabular-nums'] }}
        />
      </View>

      <View className="flex-row mt-3" style={{ gap: 10 }}>
        <Button title="Discard" variant="ghost" onPress={onDiscard} accessibilityLabel="Discard account update" className="flex-1" />
        <Button title="Confirm" variant="primary" glow onPress={onConfirm} accessibilityLabel="Confirm account update" className="flex-1" />
      </View>
    </Card>
  );
}

/** Actions under the "doesn't look like a transaction" reply — "Log anyway"
 *  runs the basic parser on the same words; "Never mind" clears the prompt.
 *  Same card shape as DeleteHandoffActions. */
export function FmRefusalActions({
  onLogAnyway,
  onDismiss,
}: {
  onLogAnyway: () => void;
  onDismiss: () => void;
}) {
  const s = useScaledType();
  return (
    <Card className="border-borderAccent self-stretch">
      <View style={{ gap: 10 }}>
        <Button title="Log anyway" variant="primary" glow onPress={onLogAnyway} accessibilityLabel="Log anyway" />
        <Pressable onPress={onDismiss} accessibilityLabel="Dismiss">
          <Text className="text-muted text-center font-semibold" style={{ fontSize: s.role.caption }}>
            Never mind
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
export function DeleteHandoffActions({
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
  const s = useScaledType();
  return (
    <Card className="border-borderAccent self-stretch">
      <Text className="text-text font-bold mb-2.5" style={{ fontSize: s.role.prompt }}>
        Delete {accountName}?
      </Text>
      <View style={{ gap: 10 }}>
        <Button title="Open in Accounts" variant="primary" glow onPress={onOpenInAccounts} accessibilityLabel="Open in Accounts to delete" />
        <Button title="Archive instead" variant="ghost" onPress={onArchive} accessibilityLabel="Archive instead" />
        <Pressable onPress={onDismiss} accessibilityLabel="Dismiss">
          <Text className="text-muted text-center font-semibold" style={{ fontSize: s.role.caption }}>
            Never mind
          </Text>
        </Pressable>
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
 *  the step: done = positive, active = primary, pending = `controlRaised`
 *  (QA round 3 BLOCKER B1: these dots sit on the hero canvas, no `surface`
 *  ancestor — `wellRecessed` was invisible there, 1.02:1 in dark). */
export function AccountFlowProgress({
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
              n < current ? 'bg-positive' : n === current ? 'bg-primaryFill' : 'bg-controlRaised'
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
export function SubtypeChoiceChips({ onChoose }: { onChoose: (answer: string) => void }) {
  return (
    <View className="flex-row flex-wrap justify-center mt-5" style={{ gap: 10 }}>
      {ACCOUNT_SUBTYPE_CHOICES.map((choice) => (
        <Chip
          key={choice.value}
          label={choice.label}
          onPress={() => onChoose(choice.label)}
          surface="canvas"
          accessibilityLabel={`Choose ${choice.label}`}
        />
      ))}
      {/* "Skip" keeps a muted label via `tone`, not a different material —
          it is not a lesser OPTION, just a de-emphasized one (glass-standard-
          adoption-spec.md S3). */}
      <Chip
        label="Skip"
        tone="muted"
        onPress={() => onChoose('skip')}
        surface="canvas"
        accessibilityLabel="Skip account type"
      />
    </View>
  );
}
