/**
 * Regression fixture for glass-standard.feature's masker scenarios (QA
 * round 4). An apostrophe in ordinary prose ("Apple's") must NOT open a
 * quote state — if it did (QA round 2's bug), everything after it,
 * including the real comment below, would silently stop being masked.
 *
 * Lives under tests/fixtures/, not app/ or src/, so it is never picked up by
 * the real source-scan scenarios (those only walk app/ and src/) — the
 * dedicated regression scenario reads this file directly instead.
 */
// Apple's iCloud encryption keeps this safe.
// THIS_REAL_COMMENT_MUST_BE_MASKED
export const marker = 1;
