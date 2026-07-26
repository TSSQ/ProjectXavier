"""FastAPI orchestrator for the parse eval harness (dev tooling — never
ships, no online endpoints in the app itself). Thin by design: invokes the
Node runner (evals/engines/run_node.mjs, a subprocess) which is the ONLY
place that touches real parse code, then scores purely in Python
(scoring.py, pure field comparison — no parse logic, no drift risk).

Run:
    cd evals && .venv/bin/uvicorn server:app --reload
    open http://127.0.0.1:8000/            # dashboard
    curl -X POST http://127.0.0.1:8000/run # JSON report

Or without a server, for quick CLI verification:
    cd evals && .venv/bin/python server.py [engine1,engine2,...]

See docs/design/eval-harness-spec.md and README.md.
"""
from __future__ import annotations

import html
import json
import os
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse, JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scoring import FIELDS, aggregate  # noqa: E402

EVALS_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVALS_DIR.parent
DATASET_PATH = EVALS_DIR / "dataset.jsonl"
RUN_NODE = EVALS_DIR / "engines" / "run_node.mjs"
ALL_ENGINES = ["heuristic", "openai", "anthropic", "fm"]

app = FastAPI(title="ProjectXavier parse eval harness")


def load_cases() -> list[dict]:
    cases = []
    with open(DATASET_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return cases


def run_engine(engine: str) -> list[dict]:
    """Invoke the Node runner for one engine over the full dataset. Never
    raises — a subprocess failure (e.g. a missing `tsx`) becomes a single
    'error' result per case so /run always returns a report instead of a
    500."""
    proc = subprocess.run(
        ["npx", "tsx", str(RUN_NODE), engine, str(DATASET_PATH)],
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


def run_report(engines: list[str] | None = None) -> dict:
    cases = load_cases()
    engines = engines or ALL_ENGINES
    results_by_engine = {e: run_engine(e) for e in engines}
    report = aggregate(cases, results_by_engine)
    return {"casesTotal": len(cases), "fields": list(FIELDS), "engines": report}


@app.post("/run")
def run(engines: str | None = Query(default=None, description="comma-separated engine ids")):
    selected = [e.strip() for e in engines.split(",")] if engines else None
    return JSONResponse(run_report(selected))


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
<h1>ProjectXavier parse eval harness — {data['casesTotal']} cases</h1>
<table>
<tr><th>engine</th>{field_headers}<th>overall</th><th>fail-to-parse</th></tr>
{''.join(rows)}
</table>
<h2>Failing cases</h2>
{''.join(failures_html) or '<p>None.</p>'}
</body></html>"""


if __name__ == "__main__":
    engines = sys.argv[1].split(",") if len(sys.argv) > 1 else None
    print(json.dumps(run_report(engines), indent=2))
