"""Helper subprocess for `evals/test-score-parity.mjs` (dev tooling — never
ships, never run directly). Reads `{"cases": [...], "results": {...}}` as one
JSON object from stdin, runs the REAL `scoring.aggregate` (no
re-implementation), and prints its report as JSON to stdout — so the Node
side can diff it against `score.mjs`'s `aggregate()` on the exact same input.
"""
import json
import sys

from scoring import aggregate

data = json.load(sys.stdin)
report = aggregate(data["cases"], data["results"])
json.dump(report, sys.stdout)
