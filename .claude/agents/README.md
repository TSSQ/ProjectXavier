# Agent pack: implementer → qa-tester → reviewer

A minimal three-role pipeline for Claude Code. One builds, two independent read-only roles verify.

## Install
Copy the `.claude/agents/` folder into the root of your repo (merge with any existing `.claude/`).
Check it into version control so the whole team shares the same agents.

Verify they're loaded by running `/agents` inside Claude Code.

## The flow
1. **implementer** — builds the task. Has write access. Returns a change report.
2. **qa-tester** — runs on the resulting diff. Read-only. Runs tests, hunts edge cases, returns a PASS/FAIL verdict with specific gaps.
3. **reviewer** — final gate after QA passes. Read-only. Judges design/security/maintainability, returns APPROVE / REQUEST-CHANGES with line references.

If QA or the reviewer comes back with blockers, hand their report back to the implementer and loop.

## How to drive it
You stay the product owner. Give the implementer a concrete, bounded task, then chain:

> Use the implementer agent to add rate limiting to the /login endpoint per the spec in TICKET-123.
> Then use the qa-tester agent on the diff.
> Then use the reviewer agent.

Or invoke each step yourself and read the report between stages — recommended at first, so you can steer before bad work compounds.

## Why two separate verifiers
QA answers "does it work and is it tested?" The reviewer answers "should this ship as written?" Keeping them separate (and read-only, with no write tools) stops them rubber-stamping the implementer's work. Independence is the whole point — don't merge them back into one agent.

## Notes / things to tune
- All three default to the `sonnet` model. Drop QA or the reviewer to a cheaper model if cost matters, or raise the implementer if tasks are hard.
- Subagents multiply token use significantly vs. a single session — start with this 3-role loop before adding more roles (PO, designer, eng-manager).
- Tool lists are deliberately narrow. The two reviewers get no Write/Edit on purpose. Widen only if you have a clear reason.
- Verify field names (`tools`, `model`, etc.) against the current docs before standardizing: https://code.claude.com/docs/en/sub-agents
