/**
 * Regression fixture for glass-standard.feature's masker scenarios (QA
 * round 4). A single-quoted string containing `//` must NOT be mistaken for
 * a comment start — if it were (QA round 3's fix, taken too far), the `//`
 * inside the URL would blind the rest of the line, including the real
 * trailing comment.
 *
 * Lives under tests/fixtures/, not app/ or src/, so it is never picked up by
 * the real source-scan scenarios (those only walk app/ and src/) — the
 * dedicated regression scenario reads this file directly instead.
 */
export const href = 'https://example.com/path'; // THIS_REAL_COMMENT_MUST_BE_MASKED
