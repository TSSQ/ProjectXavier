# UI consistency — full audit

**Date:** 2026-08-23 · **Reviewed at:** `5b7b47b` · **Live on the App Store:** v1.1.1 (build 74)
**Surface:** 20 screens + 46 components, 16,085 lines of TSX

Prompted by: *"some choices are inconsistent — some are buttons and some are
just strong texts."*

That observation is correct, and it is the visible tip of something more
specific than sloppiness.

## The finding in one line

**The design system exists, is well built, and is not used.**

This app has a real token system — 33 semantic colour tokens, a 4-step radius
scale, and an 8-role type ramp whose maths (`src/domain/scaleMath.ts`) is pure,
framework-free, and covered by the plain-Node suite so a transposed base is
caught by tests rather than a screenshot. That is better infrastructure than
most apps this size have.

Adoption:

| System piece | Defined in | Files using it | Files not |
|---|---|---|---|
| Type ramp (Dynamic Type) | `useScaledType` | **7** | 59 |
| `<Button>` | `ui/Button.tsx` | **11** | — 46 hand-rolled pills |
| `<SectionLabel>` | `ui/SectionLabel.tsx` | **3** (15 uses) | — 22 hand-rolled, 9 variants |
| `<Input>` | `ui/Input.tsx` | 6 uses | — 20 raw `TextInput` |
| `<Card>` | `ui/Card.tsx` | 19 uses | mostly adopted ✓ |
| `<BottomSheet>` | `ui/BottomSheet.tsx` | 7 | mostly adopted ✓ |

Nothing here is a case of a bad system. Every finding below is a case of a good
system being bypassed — usually because it was quicker to type the classes than
to import the component, and nothing in the toolchain objected.

## Why it happened (worth understanding before fixing)

Two of the biggest clusters are not carelessness — they are **gaps in the ramp
that 60+ call sites each improvised around.**

The type ramp's smallest role is `caption: 14`. The app's uppercase micro-labels
render at **9, 10, and 12px**, and its badges at **8, 9, 10, and 11px**. There
is no role for either. So every author who needed an overline or a badge had to
invent a size, and 60+ of them did, independently.

**The ramp is missing its bottom two rungs.** Adding `label` and `badge` roles
is a precondition for fixing findings 9–11, not a follow-up to them.

---

## Findings

### P0 — accessibility, shipping now

**1. 28 tappable targets are below the 44pt minimum. Zero use `hitSlop`.**

Apple's HIG floor is 44×44pt. Measured (`scratchpad/touch.mjs`):

| file | count | sizes |
|---|---|---|
| `manage-accounts.tsx` | 5 | 32, 36, 40pt |
| `ui/RepeatSheet.tsx` | 5 | 32pt |
| `manage-categories.tsx` | 4 | 32, 36, 40pt |
| `manage-payees.tsx` | 3 | 32, 36pt |
| `recurring.tsx` | 3 | 36, 40pt |
| 8 more files | 1 each | 32–36pt |

The 32pt ones are half the required area. `hitSlop` appears **once** in the
entire codebase, and not on any of these. This is the cheapest fix in the
document — `hitSlop` costs nothing and changes no layout.

*Disclosure: the edit pencil I added to `recurring.tsx` this week is one of the
40pt offenders. It matched the delete button beside it, which was already
wrong.*

**2. 59 of 66 files ignore Dynamic Type.** Only `index.tsx`, `welcome.tsx`,
`Button`, `ContextMenu`, `IncludeArchivedToggle`, `SwipeableRow` and
`AssistantExamplesSheet` scale. Everything else is fixed px, so a user at the
larger accessibility text sizes gets a partially-scaled interface — arguably
worse than one that doesn't scale at all, because the mismatch is jarring.

Three of the hand-rolled buttons also pin a **fixed height** (`height: 50`,
`py-3.5`) around a label that *does* scale, so at large text sizes the label
clips inside its own button.

**3. 144 of 155 `Pressable`s give no feedback when touched.** Press styling
appears in 5 files. Everywhere else, tapping produces no visual acknowledgement
at all until the action completes — and several actions (DB writes, sheet
opens) are slow enough for that gap to read as "the tap didn't register".

### P1 — the user's actual complaint

**4. `rounded-pill` means six different things.** 46 uses, and the shape carries
no consistent meaning:

| meaning | examples |
|---|---|
| **button** (tappable) | `index:2251, 3045, 3182, 3228`, `RepeatSheet:314` |
| **badge** (read-only) | `TransactionRow:107,116`, `AmountDisplay:48`, `FeedRecord:66` |
| **tab / segment** | `SegmentedControl`, `PeriodSheet:130`, `manage-categories:190` |
| **filter chip** | `dashboard:321`, `transactions:565` |
| **text link** | `index:2693–2705, 2963, 3098` |
| **page indicator** | `welcome:187` |

A rounded pill with a border is a *badge* on the transactions row and a *link*
on the assistant screen. There is no way to tell tappable from decorative by
looking. This is the root of "some are buttons and some are just strong texts"
— the shape stopped signalling.

**5. Four separate implementations of "the primary button", four heights.**

| where | height | Dynamic Type | press state |
|---|---|---|---|
| `ui/Button.tsx` | `py-3` + `minHeight: 44` | ✅ `s.role.control` | ✅ |
| `manage-accounts:552` | `py-3`, no min | ❌ `text-base` | ❌ |
| `RepeatSheet:313` | `py-3.5` | ❌ `text-base` | ❌ |
| `index:3033/3042` | `height: 50` + glow shadow | ✅ | ❌ |

`manage-accounts:552`'s class string — `rounded-pill py-3 items-center
justify-center` — is **byte-identical** to `Button.tsx:46`. It is a copy that
drifted: same look, minus the 44pt floor, minus Dynamic Type, minus press
feedback. That is the shape of every finding in this document.

**6. "Done" is rendered four different ways** — same word, same job (commit and
dismiss):

```
KeypadSheet:80    <Button title="Done" />                          ← filled pill
NoteSheet:37      <Button title="Done" />                          ← filled pill
RepeatSheet:316   <Text className="text-white font-bold text-base">   ← hand-rolled pill
DateField:95      <Text className="text-primary text-[15px] font-bold"> ← bare blue text
PeriodSheet:154   <Text className="text-accent text-base font-bold">   ← bare GREEN text
```

Five sheets, three visual treatments, two colours.

**7. "Go somewhere" has three affordances.** `dashboard:548` "Manage" is 12px
green text; `index:3471` "Show all N" is scaled blue bold text; Settings uses a
full row with a chevron. Same job, three looks, two colours, and a 4px size
difference between the two text ones.

**8. Three confirmation idioms.** 23 native `Alert.alert` calls across 12 files
(11 with `style: 'destructive'`), plus the assistant's in-app confirm card, plus
the hand-rolled stacked account-delete surface. The native alert is the right
default; the question is why two others exist.

### P1 — colour

**9. The "interactive" green and the "money in" green are the same colour.**

```
--color-accent:   #0E8A4F  (light)   #5FD497  (dark)   ← "this is tappable"
--color-positive: #149158  (light)   #33C27F  (dark)   ← "money came in"
```

Six degrees of hue apart in light mode. In a **finance app**, where green
carries a specific and important meaning, a green "Apply" button is a genuine
misread risk — and `PeriodSheet` has exactly that.

**10. Two tokens both mean "tappable".** `text-primary` (blue, 19 uses) and
`text-accent` (green, 4 uses) are used interchangeably for interactive text.
Given (9), `accent` should be retired from interactive use entirely and
`primary` made the single interactive colour.

Raw hex is *not* a problem here — 27 literals, 12 of which are `#fff`. Colour
discipline is good; it is the *semantics* that collide.

### P2 — typography

**11. 20 distinct text sizes.** Named scale classes (`text-xs` … `text-3xl`)
mixed with **12 arbitrary pixel values**:

```
text-xs 89 · text-base 58 · text-sm 32 · text-[13px] 31 · text-[10px] 20
text-[11px] 16 · text-lg 14 · text-[12px] 14 · text-[15px] 13 · text-[9px] 8
text-[28px] 6 · text-[24px] 5 · text-xl 4 · text-[14px] 4 · text-[22px] 2
text-[8px] · text-[26px] · text-[32px] · text-2xl · text-3xl
```

Note `text-xs` (12px) and `text-[12px]` both in use — the same size written two
ways, 103 times between them. See "Why it happened": most of the small
arbitrary values exist because the ramp has no role below 14.

**12. Three font weights doing two jobs.** `font-bold` (93), `font-semibold`
(64), `font-extrabold` (39). No rule distinguishes them; `font-medium` appears
once, almost certainly by accident.

**13. `SectionLabel` exists and loses 15–22 to hand-rolling.** The component is
one line of classes. It is bypassed in **9 variants**:

```
text-muted text-[9px]  font-bold uppercase tracking-wide                 ×6
text-muted text-xs     font-bold uppercase tracking-wide mx-1 mt-4 mb-2.5 ×3
text-muted text-[10px] font-bold uppercase tracking-wide mt-5 mb-2        ×3
text-muted text-xs     font-bold uppercase tracking-wide mx-1 mb-2.5      ×2
… 5 more
```

Three sizes and six spacing combinations for one conceptual element.

### P2 — surface & shape

**14. Sheets have three corner radii.** `rounded-t-3xl` (×6),
`rounded-t-2xl` (×2), `rounded-t-[22px]` (×1, `DateField`). Sheets are the
most-seen surface in the app; this is directly visible when two open in
sequence.

**15. `Combobox` uses the wrong ground.** `bg-bg` where all eight other sheets
use `bg-surface` — so one sheet sits a shade darker than the rest.

**16. The radius scale is 4 tokens; 6 more values are in use.** Tokens are
`sm/md/lg/pill`. Also present: `rounded-full` (34), bare `rounded` (18),
`rounded-xl` (13), `rounded-2xl` (3), `rounded-[18px]`, `rounded-[13px]`. Note
`rounded-full` and `rounded-pill` are the same shape reached two ways.

**17. Four expressions of "disabled".** `opacity: 0.35`, `0.55`, `0.6`, and a
colour-swap to `bg-surfaceAlt`/`text-muted` (`manage-accounts:552`). Only 10
controls set `disabled` at all.

### P3 — states & polish

**18. Empty states: consistent voice, inconsistent everything else.** All 14
read well ("No accounts yet.", "No spending in that period.") — the copy is
genuinely good. But they span four sizes (`text-xs`, `text-sm`, `text-[13px]`,
default), two alignments, and five padding values. **Only one of 14 offers an
action** (`manage-accounts:385`, "Tap + to add one") — the rest are dead ends.

**19. Loading labels vary in form.** `'Saving…'`, `'Deleting…'`, `'Testing…'`,
`'Preparing…'`, `'Recognizing…'`, `'Running…'` vs lowercase `'loading…'`. 16
`ActivityIndicator`s with no shared wrapper.

**20. 13 icon sizes for roughly three jobs.** 16 (×33), 18 (×21), 14 (×15), 15
(×9), 24 (×8), 20 (×6), 13 (×6), 22 (×5), 26, 28, 12, plus two hero sizes. The
15/16 and 13/14 pairs are indistinguishable on screen.

**21. Byte-identical triplication.** This exact string appears three times:

```
flex-row items-center bg-surfaceAlt border border-border rounded-pill px-3.5 py-2
   dashboard.tsx:321 · transactions.tsx:565 · debug-metrics.tsx:62
```

**22. Three dead components.** `ListRow`, `Bubble`, `FeedRecord` — zero
importers. `ListRow` in particular is the row primitive that would have
prevented several findings above.

---

## The pattern worth fixing

1. **Nothing enforces the system.** Typecheck and lint pass whether you import
   `<Button>` or retype its classes. `.eslintrc.js` already proves a lint rule
   can catch a whole bug class here — the NativeWind function-form-style ban
   exists precisely because that failure was invisible to every other gate. The
   same lever applies: ban arbitrary `text-[Npx]` in favour of ramp roles, and
   flag `rounded-pill` + `onPress` outside `Button`.

2. **The ramp is incomplete, so people improvise.** Findings 11 and 13 are
   ~60 call sites working around two missing roles. Add `label` and `badge`
   before touching the call sites, or they will drift straight back.

3. **Copying beats importing.** Every hand-rolled control is a fork of a shared
   one that then lost its safety properties — the 44pt floor, Dynamic Type,
   press feedback. `manage-accounts:552` is the clearest case: identical
   classes, three regressions.

4. **Shape is overloaded, so nothing is signalled.** A pill means six things.
   Until badge/chip/button are visually distinct, no amount of per-screen
   tidying will make the interface legible.

## Suggested order

Roughly cheapest-and-most-valuable first:

1. **`hitSlop` on the 28 undersized targets.** Hours, no layout change, closes
   the only P0 that affects every user with imprecise touch.
2. **Retire `accent` as an interactive colour** (findings 9, 10). Four call
   sites. Removes a green-means-two-things collision in a finance app.
3. **Add `label` + `badge` roles to the ramp**, then migrate the 60+
   hardcoded small sizes (11, 13).
4. **Fold the three hand-rolled buttons into `<Button>`** (5, 6). Recovers the
   44pt floor and Dynamic Type at each site.
5. **Split the pill** into distinct `Badge` / `Chip` / `Button` primitives (4).
   The largest change and the one that actually answers the original question.
6. Press feedback into `Pressable` wrappers (3); sheet radius (14, 15); empty
   states (18); delete or wire the dead components (22).

Steps 1–2 are a day and fix real defects. Steps 3–5 are the structural work,
and they are what "consistency" actually costs.

## Explicitly not reviewed

Motion and transitions, the Liquid Glass Phase 1 work on `claude/liquid-glass-ui`
(divergent branch), `XavierPet`/avatar rendering (its own visual language), and
the `debug-*` screens, which are developer tools — though they are counted in
the totals above, since three of them contain user-facing copies of shared
patterns.
