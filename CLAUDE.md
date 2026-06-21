# ProjectXavier — working agreement

Conventions for any agent working in this repo. Read before making changes.

## Verify before you push
A change isn't done until it's verified. Run and keep green:

```bash
npm run typecheck
npm run lint
npm test
```

The BDD suite (`tests/`) runs in plain Node — keep domain logic framework-free so
it stays testable there. Native/Expo code is excluded from that suite.

## Pull-request workflow
- Develop on the feature branch `claude/expense-tracker-app-y7rgas`; never push
  to `main` without explicit permission.
- **After implementing and verifying a new feature, ensure an open PR exists for
  the branch.** Concretely: once the feature is complete, the checks above are
  green, and the work is pushed — open a PR into `main` if one isn't already
  open; if a PR for this branch already exists, it updates automatically (don't
  open a duplicate). One PR per feature branch.
- Do **not** open a PR for incomplete/mid-feature work, pure questions, research,
  or trivial doc-only tweaks — unless explicitly asked.
- Use the GitHub MCP tools for PR actions. Don't create a PR for a different repo
  or branch than the one in scope.

## Architecture guardrails (non-negotiables)
1. Local SQLite (Drizzle) is the source of truth; back up/restore must round-trip.
2. Authentication required before financial data renders.
3. Online endpoints sit behind DDoS/WAF + rate limiting.
4. **Parameterised SQL only** — never concatenate values into SQL.
5. No PII beyond email + auth-provider id; financial data is end-to-end encrypted.
6. Validate every trust boundary with zod, including AI/OCR output (treat it as
   untrusted).
