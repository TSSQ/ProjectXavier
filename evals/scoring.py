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

# The five scored fields, named after the dataset's `expected` keys.
FIELDS = ("amountMinor", "sign", "dateISO", "category", "payee")


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


def score_case(expected: Optional[dict], parse: Optional[dict]) -> dict:
    """Score one engine's parse of one case against its expected ground truth.

    `expected is None` marks a "should fail to parse" case (dataset.jsonl's
    `expected: null`) — correct iff the engine also returned `None`. This
    mirrors the harness's own definition of a "usable parse" (see
    run_node.mjs's `usableOrNull`, itself the app's real `isUsefulDeviceParse`).

    Returns:
      { failToParseCase: bool, correct: bool (only for fail-to-parse cases),
        fields: {field: bool}, overall: bool }
    """
    if expected is None:
        correct = parse is None
        return {"failToParseCase": True, "correct": correct, "fields": {}, "overall": correct}

    if parse is None:
        # Ground truth exists but the engine produced nothing usable — every
        # field (and overall) is a miss.
        return {
            "failToParseCase": False,
            "fields": {f: False for f in FIELDS},
            "overall": False,
        }

    fields = {
        "amountMinor": parse.get("amount") == expected.get("amountMinor"),
        "sign": parse.get("type") == expected.get("sign"),
        "dateISO": _date_matches(parse.get("occurredAt"), expected.get("dateISO")),
        "category": normalize_name(parse.get("category")) == normalize_name(expected.get("category")),
        "payee": normalize_name(parse.get("payee")) == normalize_name(expected.get("payee")),
    }
    return {"failToParseCase": False, "fields": fields, "overall": all(fields.values())}


def aggregate(cases: list[dict], results_by_engine: dict[str, list[dict]]) -> dict[str, dict]:
    """Aggregate per-engine, per-field accuracy + a failing-case drill-down.

    `cases`: the dataset (each a dict with at least `id`, `text`, `expected`).
    `results_by_engine`: engine id -> list of run_node.mjs result dicts
      ({ id, status, parse, reason?, error? }).

    Returns { engine: { skipped, reason?, fieldAccuracy, overallAccuracy,
                         failToParseAccuracy, failures: [...] } }.
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
        overall_correct = 0
        overall_total = 0
        fail_to_parse_correct = 0
        fail_to_parse_total = 0
        failures: list[dict] = []
        errors: list[dict] = []

        for c in cases:
            r = by_id.get(c["id"])
            if r is None:
                continue
            if r.get("status") == "error":
                errors.append({"id": c["id"], "text": c["text"], "error": r.get("error")})
                continue

            parse = r.get("parse")
            scored = score_case(c.get("expected"), parse)

            if scored["failToParseCase"]:
                fail_to_parse_total += 1
                if scored["correct"]:
                    fail_to_parse_correct += 1
                else:
                    failures.append({"id": c["id"], "text": c["text"], "expected": None, "got": parse})
                continue

            overall_total += 1
            for f in FIELDS:
                field_total[f] += 1
                if scored["fields"][f]:
                    field_correct[f] += 1
            if scored["overall"]:
                overall_correct += 1
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

        report[engine] = {
            "skipped": False,
            "fieldAccuracy": {
                f: (field_correct[f] / field_total[f] if field_total[f] else None) for f in FIELDS
            },
            "overallAccuracy": (overall_correct / overall_total if overall_total else None),
            "failToParseAccuracy": (
                fail_to_parse_correct / fail_to_parse_total if fail_to_parse_total else None
            ),
            "counts": {
                "overallCorrect": overall_correct,
                "overallTotal": overall_total,
                "failToParseCorrect": fail_to_parse_correct,
                "failToParseTotal": fail_to_parse_total,
            },
            "failures": failures,
            "errors": errors,
        }
    return report
