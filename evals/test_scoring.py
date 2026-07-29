"""Unit tests for scoring.py (pure field comparison — no parse logic, so
these are plain, fast, offline assertions). Runnable two ways:

    pytest evals/test_scoring.py
    python3 evals/test_scoring.py
"""
from scoring import aggregate, normalize_name, score_case

NOW = "2026-07-16T04:00:00.000Z"  # matches dataset.jsonl's nowISO in UTC
TODAY_MS = 1784174400000  # 2026-07-16T12:00:00Z-ish epoch used in fixtures below
YESTERDAY_MS = TODAY_MS - 86_400_000


def _expected(**over):
    base = {
        "amountMinor": 1000,
        "sign": "expense",
        "dateISO": "2026-07-16",
        "category": "Dining",
        "payee": "Subway",
    }
    base.update(over)
    return base


def _parse(**over):
    base = {
        "amount": 1000,
        "type": "expense",
        "occurredAt": TODAY_MS,
        "category": "Dining",
        "payee": "Subway",
    }
    base.update(over)
    return base


def test_normalize_name_trims_collapses_lowercases():
    assert normalize_name("  Fair  Price ") == "fair price"
    assert normalize_name(None) is None


def test_all_fields_correct_scores_overall_true():
    scored = score_case(_expected(), _parse())
    assert scored["overall"] is True
    assert all(scored["fields"].values())


def test_amount_mismatch_fails_only_amount_and_overall():
    scored = score_case(_expected(), _parse(amount=999))
    assert scored["fields"]["amountMinor"] is False
    assert scored["fields"]["sign"] is True
    assert scored["overall"] is False


def test_sign_mismatch():
    scored = score_case(_expected(sign="income"), _parse(type="expense"))
    assert scored["fields"]["sign"] is False
    assert scored["overall"] is False


def test_category_normalized_match_ignores_case_and_whitespace():
    scored = score_case(_expected(category="fair price"), _parse(category="  Fair   Price  "))
    assert scored["fields"]["category"] is True


def test_category_unasserted_when_label_null():
    # An unasserted (null-labeled) category is EXCLUDED from `fields`
    # entirely — it's not scored at all, so it can neither pass nor fail.
    scored = score_case(_expected(category=None), _parse(category=None))
    assert "category" not in scored["fields"]


def test_category_model_proposal_ignored_when_label_null():
    # (a) A real model proposing a non-null category against a null label is
    # IGNORED, not a fail: still excluded from `fields`, and `overall` is
    # unaffected by it (true here since every OTHER field matches).
    scored = score_case(_expected(category=None), _parse(category="Dining"))
    assert "category" not in scored["fields"]
    assert scored["overall"] is True


def test_category_mismatch_still_fails_when_label_asserts_it():
    # (b) A wrong model category against a NON-null label still fails —
    # asserting a category means it's held to account.
    scored = score_case(_expected(category="Dining"), _parse(category="Groceries"))
    assert scored["fields"]["category"] is False
    assert scored["overall"] is False


def test_overall_ignores_unasserted_category_and_payee():
    # (c) `overall` only reflects fields the label actually asserted — a case
    # with null category/payee labels passes on amount/sign/date alone, even
    # though the model's category/payee guesses don't match anything real
    # (there's nothing to compare them to).
    scored = score_case(
        _expected(category=None, payee=None), _parse(category="Groceries", payee="Nike")
    )
    assert "category" not in scored["fields"]
    assert "payee" not in scored["fields"]
    assert scored["overall"] is True


def test_payee_normalized_match():
    scored = score_case(_expected(payee="subway"), _parse(payee="Subway"))
    assert scored["fields"]["payee"] is True


def test_payee_unasserted_when_label_null():
    scored = score_case(_expected(payee=None), _parse(payee="FairPrice"))
    assert "payee" not in scored["fields"]
    assert scored["overall"] is True


def test_date_exact_match():
    scored = score_case(_expected(dateISO="2026-07-16"), _parse(occurredAt=TODAY_MS))
    assert scored["fields"]["dateISO"] is True


def test_date_mismatch():
    scored = score_case(_expected(dateISO="2026-07-16"), _parse(occurredAt=YESTERDAY_MS))
    assert scored["fields"]["dateISO"] is False


def test_date_both_null_matches():
    scored = score_case(_expected(dateISO=None), _parse(occurredAt=None))
    assert scored["fields"]["dateISO"] is True


def test_fail_to_parse_case_correct_when_engine_returns_null():
    scored = score_case(None, None)
    assert scored["failToParseCase"] is True
    assert scored["correct"] is True
    assert scored["overall"] is True


def test_fail_to_parse_case_incorrect_when_engine_returns_a_parse():
    scored = score_case(None, _parse())
    assert scored["failToParseCase"] is True
    assert scored["correct"] is False
    assert scored["overall"] is False


def test_engine_returns_null_on_a_real_case_fails_every_field():
    scored = score_case(_expected(), None)
    assert scored["failToParseCase"] is False
    assert all(v is False for v in scored["fields"].values())
    assert scored["overall"] is False


def test_null_parse_still_excludes_unasserted_optional_fields():
    # Even when the engine returns nothing usable, an unasserted (null-label)
    # category/payee stays excluded rather than becoming an automatic fail —
    # only the objective fields (always asserted) count as misses here.
    scored = score_case(_expected(category=None, payee=None), None)
    assert scored["fields"] == {"amountMinor": False, "sign": False, "dateISO": False}
    assert scored["overall"] is False


# ─── aggregate() ─────────────────────────────────────────────────────────────

CASES = [
    {"id": "c1", "text": "coffee 4.80", "expected": _expected()},
    {"id": "c2", "text": "gibberish", "expected": None},
]


def test_aggregate_reports_skipped_engine():
    results = {"openai": [{"id": "c1", "status": "skipped", "reason": "no key", "parse": None}]}
    report = aggregate(CASES, results)
    assert report["openai"]["skipped"] is True
    assert report["openai"]["reason"] == "no key"


def test_aggregate_computes_field_and_overall_accuracy():
    results = {
        "heuristic": [
            {"id": "c1", "status": "ok", "parse": _parse()},
            {"id": "c2", "status": "ok", "parse": None},
        ]
    }
    report = aggregate(CASES, results)["heuristic"]
    assert report["skipped"] is False
    assert report["fieldAccuracy"]["amountMinor"] == 1.0
    assert report["overallAccuracy"] == 1.0
    assert report["failToParseAccuracy"] == 1.0
    assert report["failures"] == []


def test_aggregate_records_failing_cases_with_diff():
    results = {
        "heuristic": [
            {"id": "c1", "status": "ok", "parse": _parse(amount=1)},
            {"id": "c2", "status": "ok", "parse": _parse()},  # false positive on a fail-to-parse case
        ]
    }
    report = aggregate(CASES, results)["heuristic"]
    assert report["overallAccuracy"] == 0.0
    assert report["failToParseAccuracy"] == 0.0
    ids = {f["id"] for f in report["failures"]}
    assert ids == {"c1", "c2"}


def test_aggregate_separates_errors_from_scored_failures():
    results = {
        "openai": [
            {"id": "c1", "status": "error", "error": "boom", "parse": None},
            {"id": "c2", "status": "ok", "parse": None},
        ]
    }
    report = aggregate(CASES, results)["openai"]
    assert report["errors"] == [{"id": "c1", "text": "coffee 4.80", "error": "boom"}]
    # c1 excluded from scored totals since it errored, not a scored miss.
    assert report["counts"]["overallTotal"] == 0
    assert report["counts"]["failToParseTotal"] == 1


if __name__ == "__main__":
    import sys

    tests = [(name, fn) for name, fn in list(globals().items()) if name.startswith("test_")]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {name}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
