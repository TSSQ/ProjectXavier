# ADR 0003 — Gamified avatar evolution and cosmetic monetization

- **Status:** Superseded by [ADR 0005](0005-remove-gamification.md)
- **Date:** 2026-06-27
- **Deciders:** ProjectXavier team
- **Related:** `src/domain/avatar.ts` (`AvatarKind`, `AvatarLook`, `AvatarState`,
  `avatarStateFor`), `src/components/avatars/registry.tsx` (`renderAvatar`,
  kind→renderer), `src/components/ui/XavierPet` (the coded-SVG blob),
  `src/domain/balances.ts` (`netWorthAsOf`); IAP economics in
  `docs/design/parse-metrics-spec.md`-adjacent discussion (App Store ~15% tier).

## Context

We want to gamify the app: the AI-assistant avatar should *evolve* as the user
makes financial progress, with a free set of plain default looks and nicer looks
sold as digital goods, and AI used to generate the art.

Three decisions are tangled in that one sentence and have different answers:
1. **What signal drives evolution** (initial idea: net worth, up *and* down).
2. **What is earned vs. what is sold.**
3. **What "Claude generates assets" actually means** — Claude generates
   code/text, not raster images.

The existing avatar model already separates three axes that this design slots
into cleanly:
- `AvatarKind` (`blob` | `character` | `animated`; only `blob` available today) —
  a renderer slot, already stubbed for future kinds.
- `AvatarLook` — colour/skin variant within a kind.
- `AvatarState` (`idle|listening|thinking|happy|confused`) — transient mood, via
  pure `avatarStateFor(signals)`.

## Decision (direction)

### 1. Progression signal — earn-only, never punish on the way down
**Do not drive evolution off absolute net worth, and do not devolve/regress the
avatar when net worth falls.** In a personal-finance app, a companion that
visibly regresses when the user's finances dip is shaming exactly when the user
most needs the tool, is unfair across wealth levels (a wealthy user starts
maxed; a saver never levels), and rides a volatile/sometimes-unreliable signal.

Instead:
- **Evolution (long-term `stage`) accrues from behaviour/growth** — savings
  streak, months of positive growth *relative to the user's own baseline*, goal
  progress — and is **sticky** (accrual-only, or at most gentle decay; a bad
  month never nukes earned progress).
- **Short-term ups and downs are expressed as mood** via the existing
  `AvatarState` system (e.g. an "encouraging/concerned" state on a dip), not as
  destruction of progress.

This keeps the game loop fun and inclusive and rewards the habit the app exists
to build.

### 2. Earn progression, sell cosmetics
- **`stage` (new axis) = where you are in a creature line → earned, never sold.**
  Selling stages is pay-to-win and would kill the loop.
- **`kind` (existing) = the creature line / evolution path → the sellable unit.**
  Free "blob" line is the plain default; "dragon"/"fox"/etc. are purchasable
  lines. `AVATAR_KINDS` already reserves `character`/`animated` as
  `available: false` — that is the shelf.
- **`look` (existing) = colour/skin variant → free or paid.**
- A purchased line/skin should render across **all** stages, so it "grows with"
  the user (attachment + perceived value).
- Each `kind` renderer must therefore cover a **`stage × state` matrix**; bound
  the dimensions (e.g. ~4 stages × 5 states × N lines) before generating a
  catalogue, or the art/review workload explodes.

### 3. Asset generation — Claude-as-SVG-pipeline + AI personality (text)
Claude generates **code and text, not images**. The chosen default:
- **Design-time, curated SVG pipeline:** Claude authors parametric
  SVG/Reanimated components for each `(kind, stage, state)`, exactly as
  `XavierPet` is already hand-coded SVG. Humans review/curate/ship static, vetted
  assets. Cheap, safe, consistent, no runtime cost, no denial-of-wallet.
- **AI-generated *personality/name/dialogue* (text)** that evolves with the
  companion — plays to Claude's actual strength and sidesteps image
  quality/safety entirely.
- **Rejected for now:** runtime per-user *image* generation as the paid-cosmetics
  engine (per-gen cost, unreviewable quality/safety, consistency across
  stage×state, reopens denial-of-wallet).

## Consequences / tradeoffs

**Positive**
- Slots onto the existing `kind`/`look`/`state` model with one new axis (`stage`)
  and one new pure function (`evolutionStageFor(xp)`), mirroring the
  already-pure-and-tested `avatarStateFor`.
- Fair and inclusive progression; no shame mechanic; no PR/churn risk from
  punishing struggling users.
- `kind` becomes a natural monetization unit (sell aesthetic progression lines,
  not progress).
- Vector/SVG aesthetic keeps assets small, animatable, and reviewable.

**Negative / accepted**
- Limited to a cute/geometric vector aesthetic; rich illustrated/painterly
  characters would require an *image* model (not Claude) and heavier assets.
- The `stage × state × line` matrix is real art + review work; must be bounded.
- **No entitlement/ownership system exists yet** — `kind`/`look` are plain
  settings keys with no concept of "owned." Selling anything needs
  StoreKit/Play Billing + a receipt-verified ownership store (local + server),
  which is net-new and likely the largest piece of work here — bigger than the
  avatars themselves — and carries the ~15% store cut.

## Open questions / to lock before building

1. **Progression signal specifics** — exact XP formula (savings streak vs.
   goal progress vs. baseline-relative growth) and whether stages are
   strictly accrual-only or gently decay.
2. **Matrix dimensions** — number of stages and which states are animated per
   stage; pin before generating a catalogue.
3. **Net-worth reliability** — confirm enough users have complete-enough
   balances for any financial signal to feel fair; the signal must degrade
   gracefully when net worth is unknown.
4. **Monetization infra** — entitlement/ownership model and receipt
   verification (separate ADR; ties to IAP economics).

## Revisit criteria

- If the intended aesthetic shifts to rich illustrated characters, reopen the
  asset-pipeline decision (image model + sprite/Lottie; Claude writes the
  pipeline/prompts, not the art).
- If the core hook becomes "every companion is uniquely AI-generated," that is a
  different (free-differentiator, heavily-moderated, cost-capped) product, not a
  cosmetics store — reopen decision 3.

## Implementation impact

None yet — this ADR records direction only. First buildable slices when approved:
a pure `evolutionStageFor` + `stage` axis threaded through
`renderAvatar`/`AvatarRenderProps`, and the entitlement model as a separate
effort. No code changed by this ADR.
