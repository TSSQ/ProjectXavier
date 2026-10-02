"""Pure field-comparison scoring for the parse eval harness (dev tooling —
never ships). See docs/design/eval-harness-spec.md.

CRITICAL: no parse/prompt logic lives here — only comparing an engine's
already-produced `AiParsedExpense` (or `None`) to hand-labeled ground truth
from dataset.jsonl. The engines themselves (evals/engines/run_node.mjs) are
the only place that runs real production parse code; this module is a thin,
framework-free comparator so there is no drift risk living in Python.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

# The five possible scored fields, named after the dataset's `expected` keys.
FIELDS = ("amountMinor", "sign", "dateISO", "category", "payee")

# `amountMinor`/`sign`/`dateISO` are scored on every case (the label always
# asserts them). `category`/`payee` are ASSERTED fields — the dataset's
# labels were traced from the heuristic, so they're `None` on many cases
# where a real model legitimately proposes a value the heuristic never
# could; scoring a null label against a non-null model guess would unfairly
# tank a model engine's accuracy on cases the label simply never spoke to.
# So these two are scored ONLY when `expected[field]` is non-null — see
# `score_case` below.
OBJECTIVE_FIELDS = ("amountMinor", "sign", "dateISO")
OPTIONAL_FIELDS = ("category", "payee")


def normalize_name(name: Optional[str]) -> Optional[str]:
    """Trim, collapse inner whitespace, lowercase — mirrors
    `src/domain/textMatch.ts`'s `normalizeName`, which `category`/`payee`
    matching is scored against. Kept in sync by hand: this file is
    intentionally plain Python (comparison only), so it cannot import the
    real TS helper the way the Node engines import their real TS modules."""
    if name is None:
        return None
    return " ".join(name.strip().lower().split())


def _date_matches(occurred_at_ms: Optional[int], expected_date_iso: Optional[str]) -> bool:
    """`occurred_at_ms` (epoch ms, from the parsed `AiParsedExpense.occurredAt`)
    vs. `expected_date_iso` (a bare YYYY-MM-DD). Compared as a UTC calendar
    date since the Node runner pins TZ=UTC (see run_node.mjs) for reproducible
    relative/absolute date resolution."""
    if occurred_at_ms is None or expected_date_iso is None:
        return occurred_at_ms is None and expected_date_iso is None
    got = datetime.fromtimestamp(occurred_at_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    return got == expected_date_iso


def assert_expected_complete(expected: dict, case_id: str = "(unknown case)") -> None:
    """A label must be COMPLETE: all five keys present (category/payee may be
    None, i.e. "not asserted"; dateISO may be None for the legacy null-date
    semantics; but the KEY must exist). Raises ValueError otherwise — a missing `sign` once made
    every engine's correct "expense" score wrong (7 holdout-v2 cases),
    silently. Mirrors `assertExpectedComplete` in score.mjs."""
    missing = [f for f in FIELDS if f not in expected]
    if missing:
        raise ValueError(f"incomplete label for {case_id}: missing " + ", ".join(missing))


def score_case(expected: Optional[dict], parse: Optional[dict], case_id: str = "(unknown case)") -> dict:
    """Score one engine's parse of one case against its expected ground truth.

    `expected is None` marks a "should fail to parse" case (dataset.jsonl's
    `expected: null`) — correct iff the engine also returned `None`. This
    mirrors the harness's own definition of a "usable parse" (see
    run_node.mjs's `usableOrNull`, itself the app's real `isUsefulDeviceParse`).

    `category`/`payee` are ASSERTED fields: they're only added to `fields`
    (and so only count toward `overall`) when `expected[field]` is non-null.
    A case whose label leaves them `None` neither passes nor fails on them —
    they're simply absent from the returned `fields` dict, which keeps
    `overall` meaning "every field the label actually asserted was correct"
    rather than penalizing a model for proposing a category/payee the
    (heuristic-traced) label never spoke to.

    Returns:
      { failToParseCase: bool, correct: bool (only for fail-to-parse cases),
        fields: {field: bool}, overall: bool }
    """
    if expected is None:
        correct = parse is None
        return {"failToParseCase": True, "correct": correct, "fields": {}, "overall": correct}

    assert_expected_complete(expected, case_id)
    fields: dict[str, bool] = {}

    if parse is None:
        # Ground truth exists but the engine produced nothing usable — every
        # OBJECTIVE field is always scored as a miss; an OPTIONAL field only
        # counts as a miss when the label actually asserted it.
        for f in OBJECTIVE_FIELDS:
            fields[f] = False
        for f in OPTIONAL_FIELDS:
            if expected.get(f) is not None:
                fields[f] = False
        return {"failToParseCase": False, "fields": fields, "overall": False}

    fields["amountMinor"] = parse.get("amount") == expected.get("amountMinor")
    fields["sign"] = parse.get("type") == expected.get("sign")
    fields["dateISO"] = _date_matches(parse.get("occurredAt"), expected.get("dateISO"))
    if expected.get("category") is not None:
        fields["category"] = normalize_name(parse.get("category")) == normalize_name(
            expected.get("category")
        )
    if expected.get("payee") is not None:
        fields["payee"] = normalize_name(parse.get("payee")) == normalize_name(expected.get("payee"))
    return {"failToParseCase": False, "fields": fields, "overall": all(fields.values())}


def aggregate(cases: list[dict], results_by_engine: dict[str, list[dict]]) -> dict[str, dict]:
    """Aggregate per-engine, per-field accuracy + a failing-case drill-down.

    `cases`: the dataset (each a dict with at least `id`, `axis`, `text`,
      `expected`).
    `results_by_engine`: engine id -> list of run_node.mjs result dicts
      ({ id, status, parse, reason?, error? }).

    DENOMINATOR (reconciled — see score.mjs's matching doc comment, kept in
    sync by hand): `overallAccuracy` is defined over ALL cases (a refusal
    case, `expected is None`, counts correct on a `None` return), matching
    the `--n`-repeat pass-rate gate's population in run-eval.mjs. The old
    parse-cases-only number is still reported separately as `parseAccuracy`;
    `failToParseAccuracy` (refusal cases only) is unchanged in meaning.

    ERRORS COUNT AS FAILURES (kept in sync with score.mjs by hand): a
    `status: 'error'` case (a HARNESS fault, never a model throw) counts as a
    FAILED case in every denominator below — never correct — classified as a
    parse case or a refusal case by `expected is None` (S5), same as
    `score_case`'s own rule. It is still listed separately in `errors` too.

    Returns { engine: { skipped, reason?, fieldAccuracy, fieldCounts,
                         axisAccuracy, overallAccuracy, parseAccuracy,
                         failToParseAccuracy, counts, failures: [...] } }.
    """
    report: dict[str, dict] = {}
    for engine, results in results_by_engine.items():
        if not results:
            report[engine] = {"skipped": True, "reason": "no results"}
            continue
        if all(r.get("status") == "skipped" for r in results):
            report[engine] = {"skipped": True, "reason": results[0].get("reason", "skipped")}
            continue

        by_id = {r["id"]: r for r in results}
        field_correct = {f: 0 for f in FIELDS}
        field_total = {f: 0 for f in FIELDS}
        # "Parse cases" — the label asserts a real expense (expected is not None).
        parse_correct = 0
        parse_total = 0
        # "Refusal cases" — the label asserts the engine should return None.
        fail_to_parse_correct = 0
        fail_to_parse_total = 0
        # Per-axis breakdown over ALL cases, same "correct" rule as the
        # combined overallAccuracy below.
        axis_correct: dict[str, int] = {}
        axis_total: dict[str, int] = {}
        failures: list[dict] = []
        errors: list[dict] = []

        for c in cases:
            r = by_id.get(c["id"])
            if r is None:
                continue
            if r.get("status") == "error":
                # Listed separately AND counted as a FAILED case in every
                # denominator below — see the doc comment above.
                errors.append({"id": c["id"], "text": c["text"], "error": r.get("error")})
                axis = c.get("axis", "unknown")
                axis_total[axis] = axis_total.get(axis, 0) + 1
                if c.get("expected") is None:
                    fail_to_parse_total += 1
                else:
                    parse_total += 1
                continue

            parse = r.get("parse")
            scored = score_case(c.get("expected"), parse, c["id"])
            axis = c.get("axis", "unknown")
            axis_total[axis] = axis_total.get(axis, 0) + 1

            if scored["failToParseCase"]:
                fail_to_parse_total += 1
                if scored["correct"]:
                    fail_to_parse_correct += 1
                    axis_correct[axis] = axis_correct.get(axis, 0) + 1
                else:
                    failures.append({"id": c["id"], "text": c["text"], "expected": None, "got": parse})
                continue

            parse_total += 1
            # Only tally a field for cases where score_case actually scored
            # it — category/payee are ASSERTED fields (absent from
            # scored["fields"] when the label left them None), so their
            # denominators reflect only the cases that assert them, not every
            # case in the dataset.
            for f in FIELDS:
                if f not in scored["fields"]:
                    continue
                field_total[f] += 1
                if scored["fields"][f]:
                    field_correct[f] += 1
            if scored["overall"]:
                parse_correct += 1
                axis_correct[axis] = axis_correct.get(axis, 0) + 1
            else:
                failures.append(
                    {
                        "id": c["id"],
                        "text": c["text"],
                        "expected": c["expected"],
                        "got": parse,
                        "fieldResults": scored["fields"],
                    }
                )

        overall_correct = parse_correct + fail_to_parse_correct
        overall_total = parse_total + fail_to_parse_total

        report[engine] = {
            "skipped": False,
            "fieldAccuracy": {
                f: (field_correct[f] / field_total[f] if field_total[f] else None) for f in FIELDS
            },
            # Denominators alongside the accuracy — for the ASSERTED fields
            # (category/payee) `total` is the count of cases whose label
            # actually asserted that field, not the full case count (see the
            # scoring-fairness note above `score_case`).
            "fieldCounts": {
                f: {"correct": field_correct[f], "total": field_total[f]} for f in FIELDS
            },
            "axisAccuracy": {
                axis: {
                    "correct": axis_correct.get(axis, 0),
                    "total": axis_total[axis],
                    "accuracy": axis_correct.get(axis, 0) / axis_total[axis],
                }
                for axis in sorted(axis_total.keys())
            },
            # The reconciled definition — see the doc comment above: ALL
            # cases, refusal cases counted correct on a None return.
            "overallAccuracy": (overall_correct / overall_total if overall_total else None),
            # "Parse cases" split — what `overallAccuracy` meant here before
            # the reconciliation above.
            "parseAccuracy": (parse_correct / parse_total if parse_total else None),
            # "Refusal cases" split — unchanged in meaning from before.
            "failToParseAccuracy": (
                fail_to_parse_correct / fail_to_parse_total if fail_to_parse_total else None
            ),
            "counts": {
                "overallCorrect": overall_correct,
                "overallTotal": overall_total,
                "parseCorrect": parse_correct,
                "parseTotal": parse_total,
                "failToParseCorrect": fail_to_parse_correct,
                "failToParseTotal": fail_to_parse_total,
            },
            "failures": failures,
            "errors": errors,
        }
    return report
