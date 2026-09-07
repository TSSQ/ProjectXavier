# Ship run: glass-standard-adoption

> Durable, committed record of one `/ship` run. Agent verdicts are pasted
> verbatim. Committed in stage 6 with the `Ship-Run: glass-standard-adoption`
> commit trailer.

- **Feature:** Put the component layer on top of the material layer — six new family components, five brought to the standard, the `card` role renamed to `panel`, three missing scale tokens, and source-scan guards that make the next literal a test failure. No visual redesign.
- **Branch:** claude/liquid-glass-ui
- **Spec:** docs/design/glass-standard-adoption-spec.md · standard: docs/design/glass-style-guide.md
- **Mockup:** https://claude.ai/code/artifact/1a7ac132-aa06-4646-848a-a8a44e2de8a9 (approved 2026-09-07)
- **Started / finished:** 2026-09-07 / —

## Spec
Objective: thirteen `<Glass>` call sites sit inline in screens, every core control component is flat, and the composition rules live as prose across seven files. S0 lands the tokens and the guards first so every later step has a red test to turn green; S1–S6 add the families; S7 sorts the 52 remaining `surfaceAlt` sites into the ladder and guards the count at zero.

Auto-passed: the mockup was approved on 2026-09-07 and the spec names its own fallbacks per step (§8) — drop the `glass` flag on a menu that misrenders, fall back to a bare glyph on the sheet's close. No open product question. Sequencing per the `/ship` arguments: S0 as its own commit, then S1–S6, S7 last, with a simulator pass in dark, light and Reduce Transparency.

## QA
_pending_

## Review
_pending_

## Verify
_pending_

## Build
_pending_

## Result
_pending_
