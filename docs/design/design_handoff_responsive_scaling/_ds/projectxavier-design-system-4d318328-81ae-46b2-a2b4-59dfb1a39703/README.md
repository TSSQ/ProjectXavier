# ProjectXavier — Design System

A dark, high-contrast, neon-accented design system for **ProjectXavier**, an
AI-assistant expense tracker. This folder gives a design agent everything it
needs to produce on-brand ProjectXavier interfaces and assets — the colour and
type foundations, the icon set, reusable React components, and a full
interactive recreation of the iOS app.

---

## 1 · Product context

> **ProjectXavier** — "an expense tracker for the laziest user." You **describe
> an expense in plain language** ("12 bucks lunch at Joe's") or **snap a
> receipt**, and an avatar-driven assistant — *Xavier* — parses it into a
> structured transaction, asking clarifying questions when something's unclear.
> Manual entry, multi-account net-worth tracking, and time-period dashboards
> are all built in.

Key facts that shape the design:

- **iOS-first**, on one **React Native + Expo (TypeScript)** codebase that
  extends to Android and web. The visual language is native-iOS-flavoured
  (system font, pill controls, bottom tab bar, bottom sheets, FABs).
- **Local-first & private** — on-device SQLite, optional end-to-end-encrypted
  backup/sync. The brand tone reflects this: calm, trustworthy, no dark
  patterns.
- **Xavier the mascot** is the product's heart — an animated gradient "blob"
  avatar that reacts to what's happening (idle, listening, thinking, happy,
  confused, angry) and **evolves** as your net worth grows (level / stage).
- The core surfaces are: **Assistant** (home — the avatar + a composer),
  **Dashboard** (period overview, charts, accounts), **Transactions** (a
  searchable day-grouped ledger), and **Settings**.

### Sources used to build this system

This system was reverse-engineered from the product's own source of truth — not
from screenshots. If you have access, explore these for deeper fidelity:

- **GitHub — `TSSQ/ProjectXavier`** (private) · https://github.com/TSSQ/ProjectXavier
  - Design tokens: `src/theme/tokens.ts`, `tailwind.config.js` (NativeWind)
  - Icon indirection: `src/theme/assets.ts` (Feather via `@expo/vector-icons`)
  - Mascot: `src/components/ui/XavierPet.tsx`, `src/domain/avatar.ts`,
    `src/components/avatars/registry.tsx`
  - UI primitives: `src/components/ui/*` (Button, Card, SegmentedControl,
    Stat, TransactionRow, Bubble, BarChart, …)
  - Screens: `app/(tabs)/{index,dashboard,transactions,settings}.tsx`

The repo is a private React-Native app; the components here are **web (React +
inline-style) recreations** of those primitives — cosmetically faithful, not
the production implementations.

---

## 2 · Content fundamentals — how ProjectXavier writes

The voice is **a friendly, low-effort, slightly playful financial sidekick.**
Xavier talks *to* you in the first person; the app never lectures.

- **Voice & person.** First-person assistant ("**I'm** Xavier", "Let me look at
  that…", "**I** couldn't save that"). Addresses the user as **you**
  ("Tell me about an expense", "Anything else?").
- **Tone.** Warm, brief, encouraging, never finger-wagging about money. Friendly
  confirmations: *"Saved! Anything else?"*, *"No problem — discarded. What
  else?"*. Gentle on errors: *"Couldn't parse that — …"*, *"I need camera
  access to scan a receipt."*
- **Casing.** **Sentence case** everywhere — buttons ("Save", "Discard", "Add
  manually"), titles ("Overview", "Settings"). The **only** uppercase is the
  tiny tracked **eyebrow / section label** ("ACCOUNTS", "PLANNED", "INCOME").
- **Length.** Terse. Labels are 1–2 words; assistant lines are one sentence.
  Microcopy does the work of a tutorial ("Prefer to type it in? Add manually").
- **Numbers.** Money is always currency-formatted with sign and tabular figures
  (`+$3,200.00`, `−$48.90`). Uses a true minus glyph "−", not a hyphen. Net
  figures are labelled by meaning: "Net savings" vs "Net spending".
- **Punctuation.** Em dashes and ellipses for a conversational beat
  ("Saved! Anything else?", "Let me look at that…"). Sparing exclamation.
- **Emoji.** Used **deliberately and narrowly** as *category/type iconography*,
  never as decoration in prose: 💰 income · 🔁 transfer · 🧾 expense, and
  account glyphs (🏦 💳 👛). The avatar carries personality, so copy stays clean.
- **Examples to imitate.**
  - Greeting: *"Hi, I'm Xavier. Tell me about an expense, or snap a receipt."*
  - Confirm: *"Got it — here's what I parsed. Save it?"*
  - Empty state: *"Tap + to add your first transaction."*
  - Upsell: *"Upgrade — unlimited AI, receipt scan, sync."*

---

## 3 · Visual foundations

A **dark, near-black UI where the only colour is meaningful** — and accent
elements *glow*. The aesthetic is "calm dark dashboard with neon voltage."

- **Colour & background.** Layered near-black surfaces (`#0E1116` page →
  `#171B22` card → `#1F2530` raised), cool blue-grey. **No gradients on
  backgrounds** — surfaces are flat. Colour is reserved for meaning: green =
  positive/income, pink = negative/expense, blue = primary action, gold =
  premium. The one tinted surface is the bluish **feature card** (`#1B2540`)
  for the net-savings callout. See `tokens/colors.css`.
- **The neon signature = glow, not gradient.** Accent controls cast a coloured
  halo (`box-shadow` with the accent colour, large blur, ~0.45 opacity): the
  Save button, the send/FAB buttons, and the Xavier avatar all glow. Gradients
  appear in exactly one place — the **avatar "looks"** (Xavier blue→violet,
  mint, sunset, gold, grape, slate). See `tokens/effects.css`.
- **Type.** System-font feel — set in **Geist** (web stand-in for the app's iOS
  system font; see Typography note). Heavy weights dominate (700–800 for
  figures and labels). Money is **Geist Mono, tabular-nums** so columns align.
  Big figures use tight tracking (−0.02em). See `tokens/typography.css`.
- **Spacing & layout.** 4px base; **24px** default screen padding; rows sit
  8–10px apart. Fixed elements: a bottom **tab bar**, a bottom-right **FAB** on
  the ledger, a pinned **composer** on the Assistant home. Content scrolls
  under. See `tokens/spacing.css`.
- **Corner radii.** Soft, not bubbly: inputs **8**, chips **12**, cards **14**
  (the workhorse), bubbles **18**, hero chart **22**, and **pills (999)** for
  every button / segmented control / badge / FAB. See `tokens/radius.css`.
- **Cards.** Flat `#171B22` surface, **1px `#2A313C` hairline border**, 14px
  radius, ~16px padding, **no drop shadow** (elevation is conveyed by the
  border + surface step, not shadow). AI / highlighted cards swap the border
  for the lit `#33406E`.
- **Borders & dividers.** Single hairline `#2A313C`. No heavy rules; sections
  are separated by the uppercase eyebrow label + whitespace.
- **Shadows.** Two systems: (1) **quiet elevation** — barely-there black shadows
  for sheets/menus only; (2) **neon glow** — the coloured halos above. Resting
  cards have neither.
- **Transparency & blur.** Used sparingly — selection highlight, avatar halo
  blur, the faint `0.16` white "sheen" ellipse on the blob. Not a glassmorphism
  system.
- **Animation.** Subtle and physical, Reanimated-derived. The avatar is always
  *alive* — a slow breathe (scale 1→1.045) + float + occasional blink; it hops
  with a **bounce** when happy, shakes when confused, pulses a ring when
  listening, bobs three dots when thinking. Easing: in-out quad for breathing,
  a spring-ish bounce for the happy hop. Durations ~150ms for control feedback,
  ~1.9s for the breathe cycle. See the `xv-*` keyframes in `tokens/base.css`.
- **Hover / press states.** It's a touch app: presses **scale down** (buttons
  to 0.97, icon buttons to 0.92). On web, the primary affordance is the glow +
  the fill; there's no elaborate hover system.
- **Imagery vibe.** There is **no photography** — the brand is procedural. The
  only "image" is Xavier, rendered live. Keep it that way: prefer the mascot,
  the charts, and the emoji chips over stock imagery.

---

## 4 · Iconography

- **One set: Feather.** The app uses Feather icons (via `@expo/vector-icons`,
  mapped in `src/theme/assets.ts`). 24-unit grid, **2px stroke, round caps &
  joins, no fill**, drawn in `currentColor`.
- **In this system** Feather geometry is inlined in the **`Icon`** component
  (`components/core/Icon.jsx`) — no runtime dependency, crisp at any size, and
  it inherits text colour inside buttons/rows. The full set is shown on the
  *Iconography — Feather set* card. Glyphs covered: home · bar-chart-2 · list ·
  settings · send · camera · plus · search · calendar · chevron-{down,right,up,
  left} · credit-card · tag · users · lock · star · edit-2 · trash-2 · check ·
  x · download · upload · log-out · more-horizontal · activity · eye · repeat ·
  arrow-up-right · zap.
  > **Substitution note:** the inlined paths are Feather's own (MIT). If you
  > need a glyph not in the map, add it from Feather/Lucide (same stroke style)
  > — don't mix in a different icon family.
- **Emoji as category icons.** Transaction types and accounts use emoji on
  tinted chips — 💰 income · 🔁 transfer · 🧾 expense · 🏦 💳 👛 accounts. This is
  intentional product iconography, not decoration. Reuse these exact glyphs.
- **No custom illustration** beyond the Xavier mascot. Don't hand-draw new
  SVG art; use the `Icon` set, the emoji chips, and `XavierAvatar`.

### Typography substitution — please confirm

The native app renders in the **iOS/Android system font (SF Pro / Roboto)**,
which isn't a licensable webfont. This system substitutes **Geist** (a neutral
grotesque with SF-Pro-like proportions) + **Geist Mono** for figures, loaded in
`tokens/fonts.css`. **If you have the real brand/SF-Pro binaries**, drop them in
and replace the `@import` with `@font-face` rules. Flagging so you can correct
it.

---

## 5 · Index / manifest

**Foundations**
- `styles.css` — the entry point consumers link (imports-only manifest).
- `tokens/colors.css` · `typography.css` · `spacing.css` · `radius.css` ·
  `effects.css` · `fonts.css` · `base.css` — all design tokens (`--xv-*`) plus
  app-vocabulary aliases.
- `guidelines/*.card.html` — foundation specimens shown on the **Design System**
  tab (Colors, Type, Spacing, Brand).

**Components** (`components/<group>/<Name>.{jsx,d.ts,prompt.md}`, namespace
`window.ProjectXavierDesignSystem_4d3183`)
- **core/** — `Button`, `IconButton`, `Card`, `Badge`, `SectionLabel`,
  `ListRow`, `Icon`
- **forms/** — `SegmentedControl`, `Pill`, `TextField`
- **data/** — `StatTile`, `TransactionRow`, `AccountRow`, `MiniBarChart`
- **feedback/** — `XavierAvatar` (the mascot), `Bubble`

**UI kit**
- `ui_kits/projectxavier-app/` — the full **interactive iOS app** recreation
  (Assistant · Dashboard · Transactions · Settings) in a phone frame. Open
  `index.html`. Built from the components above + `data.js` fixtures.

**Meta**
- `SKILL.md` — makes this folder usable as a Claude Code Agent Skill.
- `README.md` — this file.

> The compiler auto-generates `_ds_bundle.js`, `_ds_manifest.json`, and
> `_adherence.oxlintrc.json`. Never edit those by hand.
