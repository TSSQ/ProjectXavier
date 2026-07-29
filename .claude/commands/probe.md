# /probe <text> [runs]  |  /probe --suite

Test Apple Foundation Models behavior on this Mac with the app's EXACT parse
or query contract — prompt tuning in seconds instead of a 10-minute TestFlight
cycle. Background + recreation instructions: memory `fm-probe-harness`.

1. For expense parse, point at the **committed** harness: `evals/fm/probe.swift`
   (built via `evals/fm/build.sh` -> `evals/fm/probe`), the same probe the
   `fm` engine in `evals/engines/run_node.mjs` / `npm run eval:fm`
   uses — the ad-hoc probe and the eval share one harness, so a prompt-tuning
   session and the gate never drift apart. `evals/fm/check-sync.mjs` (`node
   evals/fm/check-sync.mjs`) is the standing proof it still matches
   `src/domain/deviceParsePrompt.ts` verbatim — run it after any hand-edit to
   `probe.swift`. `<scratchpad>/fm-probe/query.swift` (query intents) has no
   committed counterpart yet — still per-session, recreate if missing.
   Check availability first: `swift -e 'import FoundationModels;
   print(SystemLanguageModel.default.availability)'`.
2. Compile `swiftc -O -parse-as-library`, run the text ≥3–5 times (single runs
   mislead on a small nondeterministic model), plus the regression set:
   salary/"Malaysia Trip", Subway, "coffee 5", John, NTUC, cai fan.
3. Read results against the house rule: if the model won't obey a prompt
   change reliably (arithmetic, dates, list discipline, negative
   instructions), the fix is deterministic post-processing
   (`applyGroundingGuards`, normalizers) — never more prompt words.
4. Any prompt change that passes the probe ships via /ship with the wording
   copied EXACTLY into `deviceParsePrompt.ts` (schema .describe + instructions
   + grounding hints — all three mirror spots).
