# /triage <screenshot(s) + one-line report>

Turn a device bug report into a diagnosed, fixed, shipped change.

1. **Read the screenshot(s) carefully** — extract exact text, pills, values,
   clock time (timing bugs are real: see the "today before noon" fix).
2. **Diagnose before proposing.** Parse/model issues → /probe FIRST with the
   user's exact text; recognition-vs-parse for receipts → Debug: OCR screen
   splits them. UI issues → read the actual component; check whether the old
   shipping branch already solved it (`git log` on c353b73-era commits).
   State the root cause in one sentence backed by file:line or probe output.
3. **Assess, then act**: report the diagnosis. Trivial/unambiguous fixes
   (copy, styling, an obvious guard): fix directly with checks green, no
   agent train. Anything with a design fork: give a recommendation and ask
   (AskUserQuestion). Feature-sized fixes: /ship.
4. Batch small fixes into one build rather than one build each; ask the user
   whether to cut now or ride with the next change when in doubt.
5. Update the dashboard (per /ship protocol) with a `triage` run when the fix
   goes through stages.
