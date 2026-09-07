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

  Scenario: No Feather icon size outside the ICON scale
    Given every tsx file under app and src
    Then no Feather size literal should fall outside ICON values or the icon-size allowlist
