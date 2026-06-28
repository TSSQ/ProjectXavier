# Build spec: Cashew-style transaction entry (custom keypad + assignment rows)

## Objective
Redesign the add/edit transaction bottom sheet so it never raises the system
keyboard for the amount, and so payee/category/account/date/repeat are tap-to-open
rows. This retires the whole class of keyboard-overlap bugs by removing text inputs
from the main form: the amount uses a **custom in-app keypad** (with a calculator),
and the only free-text field (note) gets its own isolated text sheet.

Grounded in our domain (NOT Cashew's): our transaction has type
(expense/income/transfer), account (+ to-account for transfers), amount, date,
payee, category, note, and repeat. **There is no "Tags" field — do not add one.**

## Target layout (the redesigned BottomSheet body)
Header (✕ / title / headerRight delete) → large **amount display** (currency pill +
receipt-scan affordance) → expense/income/transfer `SegmentedControl` → a grouped
**"Assignment" card** of rows (icon + label + value + chevron): Account, To account
(transfer only), Category, Payee, Date, Repeat (transactions screen only), Note →
**custom amount keypad pinned at the bottom** → Save button. No system keyboard on
this sheet; tapping Note opens its own small text sheet.

## Hard constraints
- Keep `BottomSheet`'s public API unchanged (`visible/onClose/title/headerRight/children`).
- Keep both screens' save flows intact: transactions.tsx (recurring-series creation
  + AI-edit diagnostics) and account/[id].tsx (create-only + copy/duplicate flow,
  account locked to the route). Share **presentation**, not save logic.
- Domain logic stays framework-free and unit-tested in the plain-Node BDD suite.
- `npm run typecheck` / `npm run lint` / `npm test` green at the end of every slice.

## Build in slices (each independently green & committable)

### Slice A — pure domain `src/domain/amountExpression.ts` (FIRST, fully tested)
Riskiest logic; land it green before any UI.

**Evaluation model: left-to-right, NOT operator precedence** (`100 + 20 × 3` → 360).
Matches calculator-amount UIs and keeps the evaluator a trivial deterministic fold.
Document this in the module header so nobody "fixes" it to precedence.

State: `AmountExpr = { tokens: Token[] }`, `Token = {kind:'num',text} | {kind:'op',op:'+'|'-'|'×'|'÷'}`.
The trailing num token's `text` is the live operand (digits + ≤1 `.`).

API:
- `emptyExpr(): AmountExpr`
- `fromMinorUnits(minor: number): AmountExpr` — seed for edit/copy (replaces the
  `toMajorUnits(...).toFixed(2)` string seeding)
- `applyKey(expr, key): AmountExpr` — pure reducer. `key`: `{digit:'0'..'9'}` | `'dot'`
  | `'op:+'|'op:-'|'op:×'|'op:÷'` | `'backspace'` | `'toggleSign'` | `'clear'`
- `displayString(expr): string` — `"100 + 20 × 3"` or `"12.30"`; empty → `"0"`
- `isComplete(expr): boolean` — no trailing operator, no divide-by-zero
- `resolveMinorUnits(expr): number | null` — eval L-to-R, round each step to 2dp,
  return minor units; `null` if not resolvable

Rules: digits append; ≤1 `.` per operand; **fractional clamps to 2 dp**; leading-zero
replacement (`0`→`5`=`5`, but `0.` preserved); operator starts fresh operand and
**replaces** a trailing operator; `toggleSign` negates current operand; backspace
deletes char→operator→empty (`emptyExpr`); divide-by-zero → `resolveMinorUnits` null;
cap total digits (constant, e.g. 12) so the display can't overflow.

BDD: `tests/__features__/amount-expression.feature` + `tests/__steps__/amount-expression.steps.ts`
covering: plain digits; 2dp clamp; leading-zero replace; `0.` preserved; addition;
mixed-ops left-to-right (360); −/×/÷ happy paths; trailing-operator → incomplete/null;
operator-replaces-operator; divide-by-zero → null; toggleSign both ways; backspace
mid-operand / removes operator / to-empty → `"0"`; max-length boundary; `fromMinorUnits(1234)`
round-trip; empty → `"0"`/null/false. Green before touching any RN file.

### Slice B — keypad behind the existing form (transactions.tsx only)
New presentational components, minimal blast radius:
- `src/components/ui/AmountKeypad.tsx` — `{ onKey: (key: AmountKey) => void }`, 4-col
  grid (`7 8 9`, `4 5 6`, `1 2 3`, bottom `+/− 0 . ⌫`, right operator column `÷ × − +`),
  existing tokens/Feather icons, **no TextInput**.
- Amount **display with a caret but no focusable input**: render `displayString(expr)`
  as big `<Text>` + a sibling 2px Reanimated blinking caret bar. No `TextInput` ⇒ no
  system keyboard ever. Include currency pill + receipt-scan `Pressable` (`onScanReceipt`
  prop, stubbed this round — visual affordance only).

Render these in place of the amount `<Input>` in transactions.tsx, driving a local
`AmountExpr`, converting at the boundary via `resolveMinorUnits`. Leave pills, combos,
note, and layout otherwise untouched. Proves the no-keyboard display on device.

### Slice C — assignment rows + pickers + pinned-keypad layout (transactions.tsx)
- `src/components/ui/AssignmentRow.tsx` — `{ icon, label, value, placeholder?, onPress }`,
  styled like the existing Repeat row; group rows in one rounded card with dividers.
- Reuse existing pickers, only re-trigger from rows: add an optional controlled-open /
  `renderTrigger` (or `hideTrigger` + external `open`) prop to `Combobox` (Category/Payee)
  and `DateField` so the **row owns the visuals** while each keeps owning its modal +
  create flow (preserve Combobox's create + payee→default-category side effect).
- Account/To-account: switch pills → row + new `src/components/ui/AccountPickerSheet.tsx`
  (modeled on RepeatSheet's bottom-sheet list; `{visible, accounts, selectedId, onSelect,
  onClose, title}`). In account/[id].tsx the Account row is read-only (locked).
- Repeat row moves into the card unchanged (`describeRuleShort`).
- Layout (Step 6): `TransactionFormSheet` is the single `children` node of `BottomSheet`;
  internally a bounded-height column — fixed AmountDisplay + SegmentedControl on top, a
  middle `ScrollView` (`flex:1`) for the assignment card, then **AmountKeypad pinned as a
  sibling BELOW the inner ScrollView** (not inside it), then Save. No TextInput ⇒ the
  outer KeyboardAwareScrollView never fights. Give the column an explicit height derived
  from the 92% sheet.

### Slice D — note sheet
`src/components/ui/NoteSheet.tsx` — a `BottomSheet`-based sheet with one multiline
`Input` + Done (`{visible, value, onChange, onClose}`). Note becomes an `AssignmentRow`
(`edit-3`, value = truncated note or "Add note") opening it. Keyboard fully isolated
here (keypad is gone from screen at that moment).

### Slice E — extract shared `TransactionFormSheet` + adopt in both screens
`src/components/transactions/TransactionFormSheet.tsx` owns form state + presentation;
each screen passes data + callbacks. Props:
`{ visible, onClose, title, mode:'add'|'edit'|'copy', accounts, categories, payees,
currency, lockedAccountId?, showRepeat?, copyLabel?, initial: FormValues,
onSave:(values)=>Promise<void>, onDelete?, onScanReceipt?, busy, error }`.
Carry amount as **minor units** via `resolveMinorUnits` (drops the brittle
`Number(form.amount)` string path; `toMinorUnits/toMajorUnits` only at the seed boundary).
- transactions.tsx: delete inline BottomSheet body (538-664) + `Pill`/`FieldLabel`
  helpers + `repeatSheetOpen` JSX (now internal); `openAdd/openEdit` build `initial`;
  keep `onSave`/`onDelete`/`usePeriod`/search/SectionList. `showRepeat`.
- account/[id].tsx: delete inline body (404-506); pass `lockedAccountId={id}`,
  `mode`, `copyLabel`; keep create-only `onSave` + `ContextMenu` copy flow.

## Verify
- BDD `amount-expression` feature (Slice A) green first.
- `npm run typecheck` / `lint` / `test` green per slice.
- Device-only (next EAS build): no system keyboard on amount; caret blink; keypad
  feel; pinned-keypad/scroll coexistence in the 92% sheet; NoteSheet keyboard isolation;
  DateField native picker; AccountPicker; copy banner; delete from headerRight.

## Out of scope
- Wiring the receipt-scan button to real OCR/parse (stub `onScanReceipt` this round).
- Any new transaction field (no Tags). BottomSheet API changes. Period/copy/series logic
  changes beyond moving call sites.

## Handoff
Build slices A→E in order; keep each green (typecheck/lint/test) and the BottomSheet API
identical. Land the pure `amountExpression` module + BDD specs first. Then qa-tester on
the diff (focus: amount-expression correctness + coverage; no system keyboard / no
TextInput on the amount path; both save flows intact; BottomSheet API unchanged; pinned
keypad layout; suite green). Then reviewer. Push per the standing rule; no PR while
Actions over budget.
