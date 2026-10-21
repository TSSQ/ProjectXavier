#!/usr/bin/env node
/**
 * Builds `evals/questions-ledger.json`, the fixed synthetic ledger the
 * question eval scores answers against (dev tooling — never ships; see
 * evals/README.md "Questions"). Seeded, so a re-run reproduces the committed
 * file byte for byte; `evals/test-questions.mjs` checks that it does.
 *
 * Realistic Singapore context, all SGD, every name invented or a well-known
 * public brand (no personal data): five accounts, a dozen expense
 * categories, four income categories, a transfer category, and 25 payees (past
 * `MAX_UNCAPPED_PAYEES`, so the grounding cap matters). Fourteen months of
 * transactions, 2025-09-01 to 2026-10-21 (the eval's `nowISO` day), plus one
 * pending and one future-dated row that every aggregate must leave out
 * (`isCounted`). Every row is stamped at local noon, Asia/Singapore.
 *
 * Usage: node evals/questions-ledger-build.mjs          # rewrites the file
 *        node evals/questions-ledger-build.mjs --check  # exit 1 if the file differs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LEDGER_PATH = path.join(__dirname, 'questions-ledger.json');

export const LEDGER_NOW_ISO = '2026-10-21T12:00:00+08:00';

const ACCOUNTS = [
  { id: 'acc-dbs', name: 'DBS Savings', subtype: 'bank', currency: 'SGD', openingBalance: 1_200_000 },
  { id: 'acc-citi', name: 'Citi Card', subtype: 'credit_card', currency: 'SGD', openingBalance: 0 },
  { id: 'acc-cash', name: 'Cash', subtype: 'cash', currency: 'SGD', openingBalance: 20_000 },
  { id: 'acc-grabpay', name: 'GrabPay', subtype: 'wallet', currency: 'SGD', openingBalance: 5_000 },
  { id: 'acc-invest', name: 'Endowus', subtype: 'investment', currency: 'SGD', openingBalance: 3_000_000 },
];

const CATEGORY_DEFS = [
  ['Food', 'expense'],
  ['Dining Out', 'expense'],
  ['Groceries', 'expense'],
  ['Transport', 'expense'],
  ['Shopping', 'expense'],
  ['Bills', 'expense'],
  ['Rent', 'expense'],
  ['Entertainment', 'expense'],
  ['Health', 'expense'],
  ['Travel', 'expense'],
  ['Subscriptions', 'expense'],
  ['Gifts', 'expense'],
  ['Salary', 'income'],
  ['Freelance', 'income'],
  ['Allowance', 'income'],
  ['Interest', 'income'],
  ['Card Payment', 'transfer'],
];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const CATEGORIES = CATEGORY_DEFS.map(([name, kind]) => ({ id: `cat-${slug(name)}`, name, kind, parentId: null, icon: null }));

const PAYEE_NAMES = [
  'Grab', 'Gojek', 'SMRT', 'FairPrice', 'Cold Storage', 'Sheng Siong', 'Kopitiam', 'Toast Box',
  'Ya Kun', "McDonald's", 'Din Tai Fung', 'Shopee', 'Lazada', 'Uniqlo', 'Netflix', 'Spotify',
  'SP Group', 'Singtel', 'Landlord', 'Guardian', 'Raffles Medical', 'Golden Village', 'Scoot',
  'Mum', 'Acme Pte Ltd', 'DBS Bank',
];
const PAYEES = PAYEE_NAMES.map((name) => ({ id: `pay-${slug(name)}`, name, defaultCategoryId: null }));

const cat = (name) => CATEGORIES.find((c) => c.name === name).id;
const pay = (name) => PAYEES.find((p) => p.name === name).id;

/** mulberry32 — tiny seeded PRNG, so the ledger is reproducible. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local noon in Singapore (UTC+8, no DST) for a calendar day. */
const sgNoon = (y, m, d) => Date.UTC(y, m, d, 4, 0, 0);

export function buildLedger() {
  const rand = prng(20261021);
  const between = (lo, hi) => Math.round(lo + rand() * (hi - lo));
  const day = (lo, hi) => between(lo, hi);
  const txs = [];
  let n = 0;
  const add = (y, m, d, type, amount, { account, category = null, payee = null, transferTo = null, note = null, pending = false }) => {
    n += 1;
    const occurredAt = sgNoon(y, m, d);
    txs.push({
      id: `tx-${String(n).padStart(3, '0')}`,
      accountId: account,
      type,
      amount,
      currency: 'SGD',
      categoryId: category ? cat(category) : null,
      payeeId: payee ? pay(payee) : null,
      transferAccountId: transferTo,
      note,
      occurredAt,
      createdAt: occurredAt,
      source: 'manual',
      pending,
    });
  };

  // 2025-09 .. 2026-10 (month index 8 of 2025 through 9 of 2026).
  for (let i = 0; i < 14; i++) {
    const y = 2025 + Math.floor((8 + i) / 12);
    const m = (8 + i) % 12;
    const lastDay = y === 2026 && m === 9 ? 21 : 28; // October 2026 is the current, partial month
    const inMonth = (lo, hi) => Math.min(lastDay, day(lo, hi));

    add(y, m, 1, 'expense', 200_000, { account: 'acc-dbs', category: 'Rent', payee: 'Landlord' });
    if (lastDay >= 25) add(y, m, 25, 'income', 650_000, { account: 'acc-dbs', category: 'Salary', payee: 'Acme Pte Ltd' });
    add(y, m, 3, 'expense', 1_998, { account: 'acc-citi', category: 'Subscriptions', payee: 'Netflix' });
    add(y, m, 5, 'expense', 1_098, { account: 'acc-citi', category: 'Subscriptions', payee: 'Spotify' });
    add(y, m, 8, 'expense', between(9_000, 16_000), { account: 'acc-dbs', category: 'Bills', payee: 'SP Group' });
    add(y, m, 9, 'expense', 4_500, { account: 'acc-citi', category: 'Bills', payee: 'Singtel' });
    add(y, m, 10, 'transfer', 80_000, { account: 'acc-dbs', category: 'Card Payment', transferTo: 'acc-citi' });
    add(y, m, 28 > lastDay ? lastDay : 28, 'income', between(800, 1_500), { account: 'acc-dbs', category: 'Interest', payee: 'DBS Bank' });

    for (let k = 0; k < 2; k++) add(y, m, inMonth(1, 28), 'expense', between(1_200, 3_200), { account: 'acc-grabpay', category: 'Transport', payee: 'Grab' });
    if (i % 2 === 1) add(y, m, inMonth(1, 28), 'expense', between(1_500, 2_500), { account: 'acc-citi', category: 'Transport', payee: 'Gojek' });
    add(y, m, inMonth(1, 28), 'expense', between(300, 600), { account: 'acc-cash', category: 'Transport', payee: 'SMRT' });

    const foodPlaces = ['Kopitiam', 'Toast Box', 'Ya Kun', "McDonald's"];
    for (let k = 0; k < 2; k++) {
      add(y, m, inMonth(1, 28), 'expense', between(450, 1_400), {
        account: k === 0 ? 'acc-cash' : 'acc-citi',
        category: 'Food',
        payee: foodPlaces[between(0, 3)],
      });
    }
    const grocers = ['FairPrice', 'Sheng Siong', 'Cold Storage'];
    for (let k = 0; k < 2; k++) {
      add(y, m, inMonth(1, 28), 'expense', between(4_000, 13_000), { account: 'acc-citi', category: 'Groceries', payee: grocers[between(0, 2)] });
    }
    add(y, m, inMonth(10, 28), 'expense', between(6_000, 11_000), { account: 'acc-citi', category: 'Dining Out', payee: 'Din Tai Fung' });

    if (i % 2 === 0) add(y, m, inMonth(1, 28), 'expense', between(2_000, 9_000), { account: 'acc-citi', category: 'Shopping', payee: ['Shopee', 'Lazada', 'Uniqlo'][between(0, 2)] });
    if (i % 3 === 1) add(y, m, inMonth(1, 28), 'expense', between(1_500, 3_000), { account: 'acc-citi', category: 'Entertainment', payee: 'Golden Village' });
    if (i % 4 === 2) add(y, m, inMonth(1, 28), 'expense', between(1_000, 4_000), { account: 'acc-cash', category: 'Health', payee: 'Guardian' });
    if (i % 3 === 0) add(y, m, inMonth(1, 20), 'income', 20_000, { account: 'acc-cash', category: 'Allowance', payee: 'Mum' });
    if (i % 5 === 3) add(y, m, inMonth(1, 28), 'income', between(30_000, 90_000), { account: 'acc-dbs', category: 'Freelance' });
    if (i % 6 === 5) add(y, m, inMonth(1, 28), 'expense', between(5_000, 15_000), { account: 'acc-cash', category: 'Gifts' });
    if (i % 3 === 2) add(y, m, 15, 'transfer', 50_000, { account: 'acc-dbs', transferTo: 'acc-invest', note: 'monthly invest' });
  }

  // One-offs.
  add(2026, 2, 12, 'expense', 38_900, { account: 'acc-citi', category: 'Travel', payee: 'Scoot', note: 'Bali flights' });
  add(2026, 5, 18, 'expense', 12_000, { account: 'acc-dbs', category: 'Health', payee: 'Raffles Medical' });
  add(2025, 11, 20, 'expense', 25_000, { account: 'acc-citi', category: 'Shopping', payee: 'Uniqlo', note: 'christmas' });
  // Never counted: a pending charge and a future-dated one.
  add(2026, 9, 20, 'expense', 99_900, { account: 'acc-citi', category: 'Shopping', payee: 'Lazada', pending: true });
  add(2026, 9, 30, 'expense', 77_700, { account: 'acc-citi', category: 'Travel', payee: 'Scoot' });

  txs.sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
  return {
    _note: 'Synthetic fixture for evals/questions.jsonl — built by evals/questions-ledger-build.mjs, do not hand-edit.',
    nowISO: LEDGER_NOW_ISO,
    currency: 'SGD',
    accounts: ACCOUNTS,
    categories: CATEGORIES,
    payees: PAYEES,
    transactions: txs,
  };
}

export function ledgerJson() {
  return JSON.stringify(buildLedger(), null, 1) + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = ledgerJson();
  if (process.argv.includes('--check')) {
    const same = readFileSync(LEDGER_PATH, 'utf8') === json;
    console.log(same ? 'questions-ledger.json matches its builder.' : 'questions-ledger.json differs from its builder — re-run it.');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(LEDGER_PATH, json);
  const l = JSON.parse(json);
  console.log(`wrote ${path.relative(process.cwd(), LEDGER_PATH)}: ${l.transactions.length} transactions`);
}
