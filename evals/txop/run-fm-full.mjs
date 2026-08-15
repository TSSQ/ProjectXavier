// Runs the exploratory transaction-op probe N times per case and scores it.
// Grades ONLY what the app would actually rely on: the op, the selector, and
// (where stated) the extracted token — never free prose.
import { execFileSync } from 'node:child_process';

const BIN = new URL('./fm-full', import.meta.url).pathname;
const RUNS = Number(process.argv[2] ?? 3);

// expect: fields that must match. Absent field = not graded.
const CASES = [
  // --- delete, deterministic selectors (the literal ask) ---
  { text: 'delete my latest transaction',            expect: { op: 'delete', selector: 'latest' } },
  { text: 'remove the last transaction',             expect: { op: 'delete', selector: 'latest' } },
  { text: 'delete the transaction I just added',     expect: { op: 'delete', selector: 'latest' } },
  { text: "delete yesterday's transaction",          expect: { op: 'delete', selector: 'date', dateToken: 'yesterday' } },
  // --- delete, fuzzy selectors (the risky ones) ---
  { text: 'delete the Kopitiam transaction',         expect: { op: 'delete', selector: 'payee', payee: /kopitiam/i } },
  { text: 'delete the $50 one',                      expect: { op: 'delete', selector: 'amount', amount: 50 } },
  // --- update ---
  { text: 'change my last transaction to 25',        expect: { op: 'update', selector: 'latest', updateField: 'amount', amount: 25 } },
  { text: 'fix the amount on my last one to 30',     expect: { op: 'update', selector: 'latest', updateField: 'amount', amount: 30 } },
  { text: 'update the Kopitiam transaction category to Dining', expect: { op: 'update', updateField: 'category', updateValue: /dining/i } },
  // --- NEGATIVES: must never fire a write ---
  { text: 'delete my savings account',               expect: { op: 'none' }, neg: true },
  { text: 'rename my wallet to Cash',                expect: { op: 'none' }, neg: true },
  { text: 'lunch 12.50',                             expect: { op: 'none' }, neg: true },
  { text: 'coffee 4',                                expect: { op: 'none' }, neg: true },
  { text: 'paid mum 50',                             expect: { op: 'none' }, neg: true },
  { text: 'how much did I spend on dining last month', expect: { op: 'none' }, neg: true },
  // --- SAFETY: must not become an unbounded destructive op ---
  { text: 'delete everything',                       expect: { op: 'none' }, neg: true, safety: true },
];

const match = (got, want) =>
  want instanceof RegExp ? want.test(String(got ?? '')) : got === want;

let totalPass = 0, totalRuns = 0;
const negFailures = [];
const rows = [];

for (const c of CASES) {
  let pass = 0;
  const seen = new Set();
  for (let i = 0; i < RUNS; i++) {
    let out;
    try {
      out = JSON.parse(execFileSync(BIN, [c.text], { encoding: 'utf8' }));
    } catch (e) {
      seen.add('ERROR');
      continue;
    }
    seen.add(`${out.op}/${out.selector}`);
    const ok = Object.entries(c.expect).every(([k, v]) => match(out[k], v));
    if (ok) pass++;
    else if (c.neg) negFailures.push({ text: c.text, got: out });
    totalRuns++;
  }
  totalPass += pass;
  rows.push({ text: c.text, pass, runs: RUNS, neg: !!c.neg, safety: !!c.safety, seen: [...seen].join(' | ') });
}

const w = Math.max(...rows.map((r) => r.text.length));
console.log(`\nFM transaction-op probe — ${RUNS} runs/case\n`);
console.log(`${'case'.padEnd(w)}  pass   observed op/selector`);
console.log('-'.repeat(w + 30));
for (const r of rows) {
  const tag = r.safety ? ' [SAFETY]' : r.neg ? ' [neg]' : '';
  const flag = r.pass === r.runs ? ' ' : r.pass === 0 ? '!' : '~';
  console.log(`${(r.text + tag).padEnd(w)} ${flag}${r.pass}/${r.runs}  ${r.seen}`);
}
console.log('-'.repeat(w + 30));
console.log(`overall: ${totalPass}/${totalRuns}`);
const posRows = rows.filter((r) => !r.neg);
const negRows = rows.filter((r) => r.neg);
console.log(`positives: ${posRows.reduce((n, r) => n + r.pass, 0)}/${posRows.length * RUNS}`);
console.log(`negatives: ${negRows.reduce((n, r) => n + r.pass, 0)}/${negRows.length * RUNS}  <-- false writes are the dangerous failure`);
if (negFailures.length) {
  console.log(`\nFALSE-POSITIVE WRITES (${negFailures.length}):`);
  for (const f of negFailures.slice(0, 10)) {
    console.log(`  "${f.text}" -> op=${f.got.op} selector=${f.got.selector} payee="${f.got.payee}" amount=${f.got.amount}`);
  }
}
