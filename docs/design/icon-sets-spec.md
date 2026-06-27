# Build spec: default selectable icon sets for accounts & categories

## Objective
Let users pick an account/category icon from a curated grid of preset emoji,
instead of typing an emoji (categories) or relying solely on the subtype-derived
icon (accounts).

## Scope (in)
- A pure data module of two curated emoji sets — one for accounts, one for
  categories.
- A reusable `IconPicker` grid component used by both manage screens.
- **Accounts:** add an explicit `icon` field (schema + type + validation +
  repository), wire the picker into the manage-accounts form, and make
  `accountIcon()` prefer the chosen icon (falling back to the subtype emoji).
- **Categories:** replace the free-text emoji `TextInput` in the manage-categories
  form with the picker (the `icon` column already exists).

## Scope (out — do not touch/build)
- Icon fonts / image assets / custom SVGs — **emoji strings only** (matches
  existing data and `accountIcon`).
- Per-icon colours/background changes — account `bg` still derives from `subtype`.
- Changing or removing `subtype` (it stays: drives `bg` + the fallback emoji).
- Grouped/categorised icon tabs, search, or skin-tone variants — flat sets only.
- Transactions/payees icons.

## Approach

**New — icon data** (`src/domain/icons.ts`, pure, framework-free)
- `export const ACCOUNT_ICONS: string[]` — ~16–24 account-relevant emoji
  (💵 🏦 💳 🏛️ 📈 👛 💰 🪙 🐷 💴 🏧 📊 …).
- `export const CATEGORY_ICONS: string[]` — ~30–40 broad spend/earn emoji
  (🍔 🛒 🚗 ⛽ 🏠 💡 📱 🎬 ✈️ 🏥 💊 🎓 👕 🎁 💪 🐶 ☕ 🍻 💼 💰 …).
- No duplicates within a set.

**New — `IconPicker`** (`src/components/ui/IconPicker.tsx`)
- Props: `{ icons: string[]; value?: string | null; onSelect: (icon: string) => void }`.
- Renders a wrapping grid of emoji `Pressable`s; the one matching `value` is
  highlighted (border-primary / surfaceAlt, like the kind picker in settings).
- **If `value` is truthy and not in `icons`, prepend it** so a previously-typed
  custom emoji stays visible and selected (no data loss on migration).
- Tapping an already-selected icon may clear it — optional; keep selection simple
  if it complicates the parent.

**Accounts — add an icon field**
- `src/domain/types.ts`: `Account.icon?: string | null`.
- `src/db/schema.ts`: `accounts` gains `icon: text('icon')`.
- `src/db/migrate.ts`: add `icon TEXT` to the `accounts` `CREATE TABLE` (fresh DBs)
  **and** an `ADD_COLUMNS` entry `{ table: 'accounts', column: 'icon', type: 'TEXT' }`
  (existing DBs) — use the established idempotent pattern.
- `src/lib/validation.ts`: `accountSchema.icon: z.string().max(16).nullable().optional()`.
- `src/features/accounts/repository.ts`: thread `icon` through `createAccount`,
  `updateAccount`, and `rowToAccount` (`icon: account.icon ?? null` /
  `row.icon ?? null`).
- `src/lib/accountIcon.ts`: widen the param to `Pick<Account,'subtype'|'icon'>`;
  return `emoji = a.icon || <subtype emoji>`; `bg` still by `subtype`. (All callers
  already pass the full account.)
- `app/manage-accounts.tsx`: add `icon` form state; render
  `<IconPicker icons={ACCOUNT_ICONS} value={icon} onSelect={setIcon} />` in the
  BottomSheet; include `icon` in the saved `Account`; seed it in `openEdit`.

**Categories — swap free-text for the picker**
- `app/manage-categories.tsx`: remove the emoji `TextInput`; render
  `<IconPicker icons={CATEGORY_ICONS} value={icon} onSelect={setIcon} />`. Keep
  storing into the existing `icon` state/column; keep the list fallback
  (`c.icon ?? '🏷️'`).

**Build order:** icons data + IconPicker → accounts wiring → categories swap → tests.

## Requirements / acceptance criteria
- [ ] `ACCOUNT_ICONS` and `CATEGORY_ICONS` are non-empty and contain no duplicates.
- [ ] `accountIcon({ icon: '🚀', subtype: 'bank' }).emoji === '🚀'`;
  `accountIcon({ icon: null, subtype: 'bank' }).emoji === '🏦'`; `bg` unchanged
  (still subtype-derived).
- [ ] `accounts` table has an `icon` column; running `migrate()` twice on an
  existing DB does not error (idempotent).
- [ ] Creating then reloading an account round-trips its `icon`; `rowToAccount`
  returns it.
- [ ] `accountSchema` accepts `icon` as string / null / undefined and rejects
  strings longer than the max.
- [ ] Manage-accounts form shows the icon grid; selecting an icon persists it, and
  the account row + dashboard + account-detail show the chosen emoji.
- [ ] Manage-categories form shows the icon grid and **no free-text emoji input**;
  selecting persists to `category.icon`; the list shows it.
- [ ] A category whose stored icon isn't in `CATEGORY_ICONS` still appears selected
  (prepended) and is preserved unchanged on save.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green; no unused imports
  left (e.g. the removed category `TextInput`/`maxLength`).

## Constraints & conventions
- Emoji strings only; icon data lives in `src/domain/icons.ts` (no RN imports →
  unit-testable).
- All DB access via Drizzle (parameterised). Migration uses the existing `TABLES`
  + `ADD_COLUMNS` idempotent approach; `icon` is nullable.
- One shared `IconPicker` used by both screens (no copy-paste grids). Match the
  existing BottomSheet field styling and the settings kind-picker selection style.
- Don't alter `subtype` semantics or the account `bg` mapping.

## Edge cases & risks
- **Custom existing category emoji** not in the set → must remain
  selected/preserved (the prepend rule); QA should verify with a pre-seeded
  oddball emoji.
- **Emoji length** — ZWJ sequences can exceed a few chars; `max(16)` accommodates
  a single emoji while bounding abuse.
- **Backups** — `Account.icon` flows through `BackupData.accounts` automatically;
  restoring an old backup yields `icon: undefined` (fine, nullable). No
  backup-code change needed; just confirm round-trip.
- **Grid in a BottomSheet** — ~40 emoji must wrap and stay scrollable within the
  sheet; don't let it overflow the Save button.
- **`accountIcon` callers** — dashboard (`p.account`), account-detail, and
  manage-accounts already pass the full account, so widening the `Pick` is safe;
  confirm none pass a bare `{subtype}`.

## Suggested handoff
> Use the implementer agent to build the spec above (icons data + IconPicker →
> accounts field/wiring → categories swap → tests). Then run qa-tester on the diff
> against the acceptance criteria (focus: migration idempotency, `accountIcon`
> icon-preference, custom-emoji preservation in categories). Then reviewer.
