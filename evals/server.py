"""FastAPI orchestrator for the parse eval harness (dev tooling — never
ships, no online endpoints in the app itself). Thin by design: invokes the
Node runner (evals/engines/run_node.mjs, a subprocess) which is the ONLY
place that touches real parse code, then scores purely in Python
(scoring.py, pure field comparison — no parse logic, no drift risk).

Run:
    cd evals && .venv/bin/uvicorn server:app --reload
    open http://127.0.0.1:8000/                     # dashboard, --split=dev by default
    curl -X POST http://127.0.0.1:8000/run           # JSON report, --split=dev by default
    curl -X POST "http://127.0.0.1:8000/run?split=holdout"   # 400: holdout/all are refused here

Or without a server, for quick CLI verification:
    cd evals && .venv/bin/python server.py [engine1,engine2,...] [split]

**Dev split only.** `split` is validated: an unknown value is a 400, and
`holdout` / `all` are rejected too (400 over HTTP, exit 2 on the CLI) with a
message pointing at the confirmed path, `node evals/run-eval.mjs
--split=holdout|all --confirm-holdout --purpose="..."`. That path is the only
one that appends to evals/holdout-looks.json; this server never does, so
letting it score holdout would be an unlogged look. (Previously it accepted
both with no confirmation and no log.)

See docs/design/eval-harness-spec.md and README.md.
"""
from __future__ import annotations

import html
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scoring import FIELDS, aggregate  # noqa: E402

EVALS_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVALS_DIR.parent
DATASET_PATH = EVALS_DIR / "dataset.jsonl"
RUN_NODE = EVALS_DIR / "engines" / "run_node.mjs"
ALL_ENGINES = ["heuristic", "openai", "anthropic", "fm"]

app = FastAPI(title="ProjectXavier parse eval harness")


VALID_SPLITS = ("dev", "holdout", "all")
HOLDOUT_SPLITS = ("holdout", "all")


def check_split(split: str) -> str:
    """Returns `split` if this server may score it, else raises ValueError
    with the message the API returns as a 400. Only "dev" is allowed:
    "holdout"/"all" would touch the holdout split without the confirmation
    and look-log that evals/run-eval.mjs enforces (evals/README.md, "Holdout
    discipline"), so they are refused and pointed at the confirmed path."""
    if split not in VALID_SPLITS:
        raise ValueError(f"unknown split {split!r}; this server only scores split=dev")
    if split in HOLDOUT_SPLITS:
        raise ValueError(
            f"split={split} touches the holdout split and is not available here (it would be an "
            "unlogged look). Use: node evals/run-eval.mjs "
            f'--split={split} --confirm-holdout --purpose="..." (appends to evals/holdout-looks.json)'
        )
    return split


def load_cases(split: str = "dev") -> list[dict]:
    """Loads evals/dataset.jsonl filtered to `split` (only "dev" passes
    `check_split`; default "dev"). Reporting/dashboard tool, not a gate."""
    check_split(split)
    cases = []
    with open(DATASET_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return [c for c in cases if c.get("split") == split]


def run_engine(engine: str, cases: list[dict]) -> list[dict]:
    """Invoke the Node runner for one engine over `cases` (already
    split-filtered by `load_cases` — step 1b.1 QA/review fix round, review
    X2: an expensive engine like `fm` must never run against a case outside
    the requested split, same discipline `evals/run-eval.mjs` enforces, not
    just the SCORING step). Writes `cases` to a throwaway temp JSONL file
    rather than pointing the Node runner at the full `DATASET_PATH`. Never
    raises — a subprocess failure (e.g. a missing `tsx`) becomes a single
    'error' result per case so /run always returns a report instead of a
    500."""
    with tempfile.TemporaryDirectory(prefix="xavier-eval-server-") as tmp_dir:
        tmp_dataset = Path(tmp_dir) / "dataset.jsonl"
        tmp_dataset.write_text("\n".join(json.dumps(c) for c in cases) + "\n", encoding="utf-8")
        proc = subprocess.run(
            ["npx", "tsx", str(RUN_NODE), engine, str(tmp_dataset)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            env={**os.environ, "TZ": "UTC"},
        )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout)[-4000:]
        return [{"id": None, "status": "error", "error": err, "parse": None}]
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return [{"id": None, "status": "error", "error": proc.stdout[-4000:], "parse": None}]


def run_report(engines: list[str] | None = None, split: str = "dev") -> dict:
    cases = load_cases(split)
    engines = engines or ALL_ENGINES
    results_by_engine = {e: run_engine(e, cases) for e in engines}
    report = aggregate(cases, results_by_engine)
    return {"casesTotal": len(cases), "split": split, "fields": list(FIELDS), "engines": report}


@app.post("/run")
def run(
    engines: str | None = Query(default=None, description="comma-separated engine ids"),
    split: str = Query(default="dev", description='"dev" only; holdout/all are rejected with 400'),
):
    try:
        check_split(split)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    selected = [e.strip() for e in engines.split(",")] if engines else None
    return JSONResponse(run_report(selected, split))


@app.get("/", response_class=HTMLResponse)
def dashboard():
    data = run_report()
    return HTMLResponse(render_dashboard(data))


def _pct(x: float | None) -> str:
    return "-" if x is None else f"{x * 100:.0f}%"


def render_dashboard(data: dict) -> str:
    rows = []
    for engine, r in data["engines"].items():
        if r.get("skipped"):
            rows.append(
                f"<tr><td>{html.escape(engine)}</td>"
                f"<td colspan='7' class='skipped'>skipped: {html.escape(r.get('reason', ''))}</td></tr>"
            )
            continue
        fa = r["fieldAccuracy"]
        rows.append(
            "<tr>"
            f"<td>{html.escape(engine)}</td>"
            + "".join(f"<td>{_pct(fa[f])}</td>" for f in data["fields"])
            + f"<td class='overall'>{_pct(r['overallAccuracy'])}</td>"
            # parseAccuracy alongside overall (review S6) — overall blends
            # parse cases and refusal cases together, so it alone can look
            # fine while parse-case accuracy (the number the model gate
            # actually cares about most) is well below threshold.
            f"<td>{_pct(r['parseAccuracy'])}</td>"
            f"<td>{_pct(r['failToParseAccuracy'])}</td>"
            "</tr>"
        )

    failures_html = []
    for engine, r in data["engines"].items():
        if r.get("skipped") or not r.get("failures"):
            continue
        items = []
        for f in r["failures"]:
            expected = json.dumps(f["expected"])
            got = json.dumps(f.get("got"))
            items.append(
                f"<li><code>{html.escape(f['text'])}</code> (id={html.escape(f['id'])})"
                f"<br>expected: <code>{html.escape(expected)}</code>"
                f"<br>got: <code>{html.escape(got)}</code></li>"
            )
        if r.get("errors"):
            for e in r["errors"]:
                items.append(
                    f"<li class='err'><code>{html.escape(e['text'])}</code> (id={html.escape(e['id'])}) "
                    f"ERROR: {html.escape(str(e['error']))[:500]}</li>"
                )
        failures_html.append(f"<h3>{html.escape(engine)}</h3><ul>{''.join(items)}</ul>")

    field_headers = "".join(f"<th>{html.escape(f)}</th>" for f in data["fields"])
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Parse eval harness</title>
<style>
body {{ font-family: -apple-system, sans-serif; margin: 2rem; color: #111; }}
table {{ border-collapse: collapse; margin-bottom: 2rem; }}
th, td {{ border: 1px solid #ccc; padding: 6px 12px; text-align: center; }}
th {{ background: #f4f4f4; }}
td:first-child, th:first-child {{ text-align: left; font-weight: 600; }}
.overall {{ font-weight: 700; }}
.skipped {{ color: #888; font-style: italic; text-align: left; }}
code {{ background: #f4f4f4; padding: 1px 4px; }}
.err {{ color: #b00; }}
h1 {{ font-size: 1.3rem; }}
</style></head>
<body>
<h1>ProjectXavier parse eval harness — {data['casesTotal']} cases (split={html.escape(data['split'])})</h1>
<table>
<tr><th>engine</th>{field_headers}<th>overall</th><th>parse cases</th><th>fail-to-parse</th></tr>
{''.join(rows)}
</table>
<h2>Failing cases</h2>
{''.join(failures_html) or '<p>None.</p>'}
</body></html>"""


if __name__ == "__main__":
    engines = sys.argv[1].split(",") if len(sys.argv) > 1 else None
    split = sys.argv[2] if len(sys.argv) > 2 else "dev"
    try:
        check_split(split)
    except ValueError as e:
        print(f"server.py: {e}", file=sys.stderr)
        sys.exit(2)
    print(json.dumps(run_report(engines, split), indent=2))
