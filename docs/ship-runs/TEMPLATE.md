# Ship run: <slug>

> Durable, committed record of one `/ship` run. Fill each section as the stage
> completes. Paste agent verdicts **verbatim** (do not paraphrase) — the whole
> point of this file is that a rejection/approval is quotable in-repo later,
> not lost in an ephemeral agent transcript. Committed in stage 6 with the
> `Ship-Run: <slug>` commit trailer.

- **Feature:** <one line>
- **Branch:** <branch>
- **Spec:** docs/design/<slug>-spec.md
- **Started / finished:** <date> / <date>

## Spec
<one-line objective + the product decision or auto-pass note>

## QA
Round 1 — **verdict:** <PASS | FAIL | PASS-WITH-CONCERNS>

<paste the qa-tester agent's verbatim verdict block: the verdict line and the
gaps/risks it listed, each with severity. If it rejected, paste the rejection
reason verbatim.>

<add "Round 2 — verdict: …" etc. for each re-gate after fixes.>

## Review
**verdict:** <APPROVE | APPROVE-WITH-NITS | REQUEST-CHANGES>

<paste the reviewer agent's verbatim verdict block, with file:line references.>

## Verify
```
<exact output of: npm run typecheck && npm run lint && npm test && npm run eval>
```
Eval provenance artifact(s): evals/results/<engine>.json

## Build
- Delivery UUID: <uuid or "n/a — non-native change">
- Build number: <n>

## Result
<shipped / device-confirmed / reverted — one line, with the commit SHA>
