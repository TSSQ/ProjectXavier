/**
 * Note-extraction probe corpus — dev tooling, never ships.
 *
 * `groundedNote` (src/domain/deviceParsePrompt.ts) trades recall for precision
 * on purpose, and the only honest way to tune that trade is to measure it
 * against a real engine. This is the corpus those numbers come from.
 *
 * `want` is the note a careful human would attach. `want: null` marks a
 * RUBBISH TRAP — an input where every word is already carried by a structured
 * field (amount, payee, category, account, date), so any note at all is noise.
 * The traps are the half that matters: recall is easy to buy (make the field
 * required and the model always fills it), precision is what costs.
 *
 * Run: node evals/note/run.mjs [--engine=fm|openai|anthropic] [--n=3]
 */
export const CASES = [
  // ── should carry a note ───────────────────────────────────────────────
  { id: 'n01', text: 'transferred 500 from budget to visa as credit card payment', want: 'credit card payment' },
  { id: 'n02', text: "spent 45 on dinner at Joe's with the team", want: 'with the team' },
  { id: 'n03', text: "paid 120 for groceries at NTUC for mum's birthday", want: "mum's birthday" },
  { id: 'n04', text: '80 taxi to the airport for the KL trip', want: 'KL trip' },
  { id: 'n05', text: 'gave John 50 to cover his share of the bill', want: 'his share of the bill' },
  { id: 'n06', text: '35 at the pharmacy, antibiotics for the dog', want: 'antibiotics for the dog' },
  { id: 'n07', text: 'transferred 2000 from checking to savings for the house deposit', want: 'house deposit' },
  { id: 'n08', text: 'paid 300 rent early this month because I am travelling', want: 'because I am travelling' },

  // ── rubbish traps: nothing left over, so the note must be empty ───────
  { id: 'r01', text: 'coffee 4', want: null },
  { id: 'r02', text: 'spent 20', want: null },
  { id: 'r03', text: '12 bucks lunch', want: null },
  { id: 'r04', text: '45 at Starbucks', want: null },
  { id: 'r05', text: 'spent 30 on groceries at FairPrice yesterday', want: null },
  // NOTE: this one is a mis-specified trap, kept deliberately. It assumes the
  // engine files "petrol" as the category; GPT-4o-mini instead answers
  // category "Transport", which leaves "petrol" as genuinely new information,
  // so "for petrol" survives the guard. Counted as a leak in the reported
  // numbers rather than quietly re-labelled.
  { id: 'r06', text: 'paid 100 on amex for petrol', want: null },
];

export const CTX = {
  categories: [
    { name: 'Dining', kind: 'expense' }, { name: 'Groceries', kind: 'expense' },
    { name: 'Transport', kind: 'expense' }, { name: 'Rent', kind: 'expense' },
    { name: 'Health', kind: 'expense' }, { name: 'Shopping', kind: 'expense' },
    { name: 'Salary', kind: 'income' },
  ],
  payees: ['Starbucks', 'FairPrice', 'NTUC', "Joe's"],
  accounts: ['Budget', 'Visa', 'Checking', 'Savings', 'Amex'],
  nowISO: '2026-08-17T12:00:00+08:00',
};
