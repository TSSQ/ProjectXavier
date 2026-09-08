Feature: Glass standard — component-family boundary guards

  glass-standard-adoption-spec.md S0. Six new family components (Fab,
  IconButton, Chip, Badge, MenuPanel, MenuRow) replace thirteen inline
  `<Glass>` call sites across S1-S7; these source-scan scenarios are the
  guard that makes the next stray literal a test failure instead of a code
  review catch, landed ahead of the migration itself so every later step
  turns a named scenario green (see spec §3, §4 S0, §8).

  Each scenario's allowlist names exactly the call sites S1-S7 have not yet
  reached and the step that removes them — a red scenario at S0 is the plan;
  a failing suite is not.

  Scenario: Glass is only ever used through a family component
    Given every tsx file under app and src
    Then every "<Glass" use should be inside a glass family component file or the allowlist

  Scenario: No call site uses the retired "card" material
    Given every tsx file under app and src
    Then no file should use material="card"

  Scenario: No 56pt box literal outside Fab
    Given every tsx file under app and src
    Then no file should pair a width 56 and height 56 literal outside Fab.tsx or the allowlist

  # QA round 2 MINOR 5: brace-range pairing only sees a width/height 56 pair
  # sharing ONE enclosing object literal. A style ARRAY splitting them across
  # two objects (or two StyleSheet.create keys spread together) defeats it —
  # there is no local text span to widen the search to without risking a
  # false pair across unrelated sibling objects (see the steps file header).
  # This is a documented, accepted blind spot: the fixture pins today's
  # actual (undetected) behaviour so a future "improvement" that starts
  # silently merging unrelated objects is caught here first.
  Scenario: A width/height 56 pair split across a style array is not detected (known limit)
    Given a fixture file with a 56pt box split across a style array
    Then the 56pt scan should not flag it — a documented blind spot, not a false pass

  Scenario: No Feather icon size outside the ICON scale
    Given every tsx file under app and src
    Then no Feather size literal should fall outside ICON values or the icon-size allowlist

  # QA round 1: the scan above matched `<Feather ... size={N} .../>` per LINE,
  # so a tag whose `size={N}` sits on a different line from `<Feather` — the
  # idiomatic multi-line RN/Prettier wrap — matched nothing at all: not
  # flagged, and not counted against the file's allowlist budget either.
  # Three real offenders (app/manage-accounts.tsx, app/recurring.tsx,
  # src/components/ui/IncludeArchivedToggle.tsx) were invisible this way.
  # This fixture pins the regression so the premise of S0 — "the next stray
  # literal is a test failure" — actually holds for the common case.
  Scenario: A multi-line Feather size literal is still detected
    Given a fixture file with a multi-line off-scale Feather icon
    Then the scan should still find that Feather's size, off-scale and all

  # QA round 2 MAJOR 1, vector 2: the tag-extent scan above used to stop dead
  # at the first '>' after `<Feather` — an ordinary quoted attribute value
  # containing '>' (an accessibilityLabel here; a `testID={x > 0 ? … }` or a
  # `{/* comment > */}` in the wild) hid an otherwise-plain off-scale literal
  # with no trace at all.
  Scenario: A stray '>' before size does not hide an off-scale literal
    Given a fixture file with a stray '>' character before a Feather's size
    Then the scan should still find that Feather's size, off-scale and all

  # QA round 2 MAJOR 1, vector 1: a non-literal `size={…}` (an arbitrary
  # variable, a formula) used to produce zero matches — not flagged, not
  # counted against any budget. `app/welcome.tsx:319`'s
  # `size={Math.round(size * (56 / 140))}` was exactly this, live in the
  # tree. It must now surface as a match the scan can't statically resolve,
  # forcing an allowlist decision rather than passing invisibly.
  Scenario: A non-literal Feather size is flagged as computed, not silently ignored
    Given a fixture file with a non-literal Feather size expression
    Then the scan should report it as a computed size needing an allowlist entry

  # QA round 2 MAJOR 2: the R9 "may a Glass mount yet" decision has its own
  # domain-level regression coverage (glass-mount-gate.feature), but nothing
  # guarded the WIRING at BottomSheet's own close-button call site — swapping
  # `glass={showGlass}` for a bare `glass` or `glass={true}` would leave every
  # other gate green, silently reintroducing the exact bug QA round 1 found.
  Scenario: BottomSheet's close IconButton passes a gated glass prop, not a literal
    Given BottomSheet.tsx's source
    Then its close IconButton's "glass" prop should not be a literal true or false

  # QA round 2 introduced this bug fixing a round-1 tag-scan bypass: treating
  # EVERY `'` as a string delimiter meant an apostrophe in ordinary prose
  # ("Apple's iCloud", app/backups.tsx:278) opened a quote state that never
  # closed, silently un-masking every real comment for the rest of the file.
  Scenario: An apostrophe in prose doesn't blind a later real comment
    Given a fixture file with an apostrophe in a comment followed by another comment
    Then the masker should still blank the later comment

  # QA round 3's fix for the scenario above went too far the other way:
  # dropping `'` as a delimiter entirely means a real single-quoted string
  # containing `//` (a URL) is mistaken for a comment start, silently
  # blinding the rest of that line — a false NEGATIVE, the failure direction
  # both prior rounds were trying to avoid.
  Scenario: A single-quoted string containing // is not mistaken for a comment
    Given a fixture file with a single-quoted URL followed by a real trailing comment
    Then the masker should preserve the string and still blank the trailing comment

  # S7 (glass-standard-adoption-spec.md §4 S7) sorted the 52-site legacy
  # `surfaceAlt` alias into `controlRaised` / `wellRecessed` / `badgeFlat` /
  # `surface`. This scenario is the guard: the alias may still be assigned
  # its per-theme hex in the two token files, and MenuRow's pressed state
  # keeps it deliberately (style guide F9 — a menu row pressed state, not one
  # of the 52 sorted sites), but nowhere else.
  Scenario: No call site outside the token files uses the retired surfaceAlt alias
    Given every tsx and ts file under app and src
    Then no "bg-surfaceAlt", "c.surfaceAlt" or "colors.surfaceAlt" use should appear outside tokens.ts, glassTokens.ts or the allowlist
