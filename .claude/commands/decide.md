---
description: Turn a decision into a clean, implementer-ready spec. Use after /discuss once you've picked a direction. Captures the what and the constraints; hands off to the implementer. Does not write code itself.
argument-hint: [the option you picked + any constraints, e.g. "go with the Redis cache, 5-min TTL"]
allowed-tools: Read, Grep, Glob
disable-model-invocation: true
model: opus
---

The user has decided on a direction (likely from a prior /discuss) and wants it turned into a precise spec the implementer agent can build from. Here's their decision:

$ARGUMENTS

Your job is to produce a clean, unambiguous build spec — not to build it. Do NOT write or edit code in this command. The output is a handoff document.

## Before writing the spec
1. **Read the relevant code.** Ground the spec in what actually exists — real files, functions, current patterns. The implementer should not have to rediscover what you already can see.
2. **Resolve ambiguity now, not later.** If the decision leaves a material question open (data shape, error behavior, edge cases, where a thing lives), either resolve it from the codebase's existing conventions or ask up to TWO sharp questions and stop. A vague spec produces wrong code — catching it here is cheap.

## The spec to produce
Write it as a tight handoff document with these sections:

**Objective** — one or two sentences: what we're building and why. The decision, stated plainly.

**Scope** — bullet list of what's in. Then an explicit "Out of scope" list of what NOT to touch or build, so the implementer doesn't wander.

**Approach** — the chosen design, concretely. Which files/modules change, what gets added, how it fits the existing architecture. Name the real paths.

**Requirements / acceptance criteria** — a checklist of conditions that must be true for this to be done. Make them testable ("returns 429 when over limit", not "handles limits well"). This is what QA will verify against.

**Constraints & conventions** — anything the implementer must respect: existing patterns to match, libraries to use or avoid, performance or compatibility limits.

**Edge cases & risks** — the non-obvious situations to handle, and anything you flagged as risky.

**Suggested handoff** — end with the exact line to kick off the build, e.g.:
> Use the implementer agent to build the spec above. Then run qa-tester on the diff, then reviewer.

## Tone
Precise and economical. Every line should reduce ambiguity for whoever builds this. No motivational filler. If the decision itself looks wrong or underspecified in a way that matters, say so before writing the spec — don't faithfully spec a mistake.
