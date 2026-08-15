// Grades the MINIMAL contract: op only. This is the "model detects intent,
// user picks the row" design — so op is the ONLY thing that has to be right.
import { execFileSync } from 'node:child_process';

const BIN = new URL('./fm-min', import.meta.url).pathname;
const RUNS = Number(process.argv[2] ?? 5);

const CASES = [
  // --- should open the DELETE flow ---
  { text: 'delete my latest transaction', op: 'delete' },
  { text: 'remove the last transaction', op: 'delete' },
  { text: 'delete the transaction I just added', op: 'delete' },
  { text: "delete yesterday's transaction", op: 'delete' },
  { text: 'delete the Kopitiam transaction', op: 'delete' },
  { text: 'delete the $50 one', op: 'delete' },
  { text: 'I want to remove a transaction', op: 'delete' },
  { text: 'get rid of that coffee entry', op: 'delete' },
  // --- should open the UPDATE flow ---
  { text: 'change my last transaction to 25', op: 'update' },
  { text: 'fix the amount on my last one to 30', op: 'update' },
  { text: 'update the Kopitiam transaction category to Dining', op: 'update' },
  { text: 'edit my last expense', op: 'update' },
  // --- must NOT open any flow ---
  { text: 'delete my savings account', op: 'none', neg: true },
  { text: 'rename my wallet to Cash', op: 'none', neg: true },
  { text: 'lunch 12.50', op: 'none', neg: true },
  { text: 'coffee 4', op: 'none', neg: true },
  { text: 'paid mum 50', op: 'none', neg: true },
  { text: 'how much did I spend on dining last month', op: 'none', neg: true },
  { text: 'add a DBS savings account with 500', op: 'none', neg: true },
  { text: 'delete everything', op: 'none', neg: true, safety: true },
];

let pos = 0, posTot = 0, neg = 0, negTot = 0, errors = 0;
const rows = [];
const falsePos = [];

for (const c of CASES) {
  let pass = 0;
  const counts = {};
  for (let i = 0; i < RUNS; i++) {
    let got;
    try {
      got = JSON.parse(execFileSync(BIN, [c.text], { encoding: 'utf8' })).op;
    } catch {
      got = 'ERROR';
      errors++;
    }
    counts[got] = (counts[got] ?? 0) + 1;
    if (got === c.op) pass++;
    else if (c.neg && got !== 'ERROR') falsePos.push({ text: c.text, got });
    if (c.neg) negTot++; else posTot++;
  }
  if (c.neg) neg += pass; else pos += pass;
  rows.push({ ...c, pass, counts });
}

const w = Math.max(...rows.map((r) => r.text.length));
console.log(`\nFM MINIMAL transaction-intent probe (op only) — ${RUNS} runs/case\n`);
console.log(`${'case'.padEnd(w)}  want     pass   observed`);
console.log('-'.repeat(w + 42));
for (const r of rows) {
  const tag = r.safety ? ' [SAFETY]' : r.neg ? ' [neg]' : '';
  const flag = r.pass === RUNS ? ' ' : r.pass === 0 ? '!' : '~';
  const obs = Object.entries(r.counts).map(([k, v]) => `${k}x${v}`).join(' ');
  console.log(`${(r.text + tag).padEnd(w)}  ${r.op.padEnd(7)} ${flag}${r.pass}/${RUNS}  ${obs}`);
}
console.log('-'.repeat(w + 42));
console.log(`positives (opens the right flow): ${pos}/${posTot}  ${(100 * pos / posTot).toFixed(0)}%`);
console.log(`negatives (must not open a flow): ${neg}/${negTot}  ${(100 * neg / negTot).toFixed(0)}%`);
console.log(`overall: ${pos + neg}/${posTot + negTot}   context/other errors: ${errors}`);
if (falsePos.length) {
  console.log(`\nFALSE FLOW OPENINGS (${falsePos.length}):`);
  const seen = new Set();
  for (const f of falsePos) {
    const k = `${f.text}->${f.got}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  "${f.text}" -> ${f.got}`);
  }
}
