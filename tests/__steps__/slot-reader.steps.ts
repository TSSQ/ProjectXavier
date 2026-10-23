import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { readSlots, SlotDirection } from '../../src/domain/slotReader';
import { resolveSlotPayee } from '../../src/domain/slotPayee';
import { readSign } from '../../src/domain/signReader';
import { finishFmParse, FmDeviceParse } from '../../src/domain/fmParse';
import { planFmAmount } from '../../src/domain/fmAmountPlan';
import { localParse } from '../../src/domain/localParse';
import { appliedDefaultsOf } from '../../src/domain/correctionEdits';
import { PhraseMemoryRow, queryTermKey } from '../../src/domain/phraseMemory';
import { TransactionDraft } from '../../src/domain/assistant';
import { Account, Payee, TransactionType } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/slot-reader.feature'));

const NOW = Date.UTC(2026, 9, 23, 4);
const FIELDS = { currency: '', category: '', account: '', note: '', occurredOn: '', confidence: 0.9, pending: false };

const names = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const orNull = (s: string) => (s === 'none' ? null : s);

defineFeature(feature, (test) => {
  let accounts: Account[] = [];
  let payees: Payee[] = [];
  let memory: PhraseMemoryRow[] = [];
  let modelObject: Record<string, unknown> = {};
  let text = '';
  let finished: FmDeviceParse | null = null;
  let heuristic: ReturnType<typeof localParse> | null = null;
  let draft: TransactionDraft | null = null;

  beforeEach(() => {
    accounts = [];
    payees = [];
    memory = [];
    finished = null;
    heuristic = null;
    draft = null;
  });

  const slotsOf = (t: string) =>
    readSlots(t, { now: NOW, payees: payees.map((p) => p.name), accounts: accounts.map((a) => a.name) });

  const givenAccounts = (step: any) =>
    step(/^the user's accounts are "(.*)"$/, (s: string) => {
      accounts = names(s).map((name, i) => ({ id: `acct-${i}`, name, currency: 'USD', openingBalance: 0 }));
    });
  const givenPayees = (step: any) =>
    step(/^the user's payees are "(.*)"$/, (s: string) => {
      payees = names(s).map((name, i) => ({ id: `payee-${i}`, name }));
    });
  const thenSlots = (step: any) =>
    step(
      /^the slots read from "(.*)" are "(to_me|from_me)", person "(.*)", purpose "(.*)"$/,
      (t: string, direction: SlotDirection, person: string, purpose: string) => {
        const s = slotsOf(t);
        expect({ t, direction: s.direction, person: s.person, purpose: s.purpose }).toEqual({
          t,
          direction,
          person: orNull(person),
          purpose: orNull(purpose),
        });
      }
    );
  const thenNoDirection = (step: any) =>
    step(/^the slots read from "(.*)" have no direction$/, (t: string) => {
      expect({ t, direction: slotsOf(t).direction, person: slotsOf(t).person }).toEqual({ t, direction: null, person: null });
    });
  const thenResolves = (step: any) =>
    step(/^the person "(.*)" resolves to payee "(.*)" by "(.*)"$/, (person: string, payee: string, how: string) => {
      expect(resolveSlotPayee(person, payees, memory)).toEqual({ name: payee, how });
    });

  test('Someone gave, sent, paid, returned or lent the user money', ({ then }) => thenSlots(then));
  test('The user got, received or borrowed money from someone', ({ then }) => thenSlots(then));
  test('The user gave, sent, paid, returned or lent someone money', ({ then }) => thenSlots(then));
  test('Where the structure does not say who gave to whom, the reader stands aside', ({ then }) =>
    thenNoDirection(then));

  test("The user's own accounts are never the person", ({ given, then, and }) => {
    givenAccounts(given);
    thenNoDirection(then);
    thenSlots(and);
  });

  test("A lowercase word is a person when it is one of the user's payees", ({ given, then, and }) => {
    givenPayees(given);
    thenSlots(then);
    thenNoDirection(and);
  });

  test('The sign reader lets who gave to whom decide over "for"', ({ then }) => {
    then(/^the sign read from "(.*)" is "(income|expense)" by the slot reader$/, (t: string, type: string) => {
      expect({ t, read: readSign(t) }).toEqual({ t, read: { type, rule: 'slot-direction' } });
    });
  });

  test('"for" is a purpose, not a spend, when money moved between the user and someone', ({ then }) => {
    then(/^the sign read from "(.*)" is "(income|expense)"$/, (t: string, type: string) => {
      expect({ t, type: readSign(t)?.type }).toEqual({ t, type });
    });
  });

  test('A strong word outside the deciding clause is a competing reading', ({ then }) => {
    then(/^the sign read from "(.*)" is undecided$/, (t: string) => {
      expect(readSign(t)).toBeNull();
    });
  });

  test("The person resolves through the user's own payees, else stays the user's word", ({ given, then }) => {
    givenPayees(given);
    thenResolves(then);
  });

  test('A payee the user taught on the Ask card is remembered for the person', ({ given, and, then }) => {
    givenPayees(given);
    and(/^phrase memory remembers payee "(.*)" for the word "(.*)"$/, (payee: string, word: string) => {
      memory = [
        {
          key: queryTermKey('payee', word),
          verdict: null,
          type: null,
          categoryId: null,
          payeeId: payees.find((p) => p.name === payee)!.id,
          accountId: null,
          hits: 1,
          reverts: 0,
          lastUsedAt: NOW,
          updatedAt: NOW,
        },
      ];
    });
    thenResolves(then);
  });

  test('The finished parse takes its type and payee from the slots', ({ given, and, when, then }) => {
    givenPayees(given);
    givenAccounts(and);
    and(
      /^the model answered type "(.*)" and payee "(.*)" for "(.*)"$/,
      (type: TransactionType, payee: string, t: string) => {
        text = t;
        modelObject = { ...FIELDS, isTransaction: true, type, payee: payee === 'none' ? '' : payee };
      }
    );
    when('the parse is finished', () => {
      finished = finishFmParse(modelObject, text, planFmAmount(text), NOW, 'USD', accounts, { payees });
    });
    then(/^the finished type is "(.*)" and payee "(.*)", slot fields "(.*)"$/, (type: string, payee: string, slots: string) => {
      expect({
        type: finished?.type,
        payee: finished?.payee,
        slots: finished?.slotApplied ?? [],
      }).toEqual({ type, payee, slots: slots === 'none' ? [] : names(slots) });
    });
  });

  test('The heuristic floor reads the same slots', ({ given, when, then }) => {
    givenPayees(given);
    when(/^I locally parse "(.*)" with those payees$/, (t: string) => {
      heuristic = localParse(t, { categories: [], payees, now: NOW });
    });
    then(/^the heuristic gives type "(.*)" and payee "(.*)"$/, (type: string, payee: string) => {
      expect({ type: heuristic?.type, payee: heuristic?.payee }).toEqual({ type, payee });
    });
  });

  test('The slot fields are named on the correction capture', ({ given, then }) => {
    given('a draft whose type and payee the slot reader set', () => {
      draft = {
        accountId: 'acct-0',
        type: 'income',
        amount: 1200,
        currency: 'USD',
        categoryName: null,
        payeeName: 'Brother',
        note: null,
        occurredAt: NOW,
        source: 'ai',
        defaulted: { account: true, payee: false, category: true, date: true },
        slotApplied: ['type', 'payee'],
      };
    });
    then(/^its applied defaults are "(.*)"$/, (s: string) => {
      expect(appliedDefaultsOf(draft!)).toEqual(names(s));
    });
  });
});
