#!/usr/bin/env node
/**
 * Pipeline dashboard renderer. Reads state.json (same dir), writes
 * dashboard.html (same dir) — a self-contained page (no external requests;
 * artifact CSP-safe). Invoked by /ship, /build, /triage after every stage
 * transition; the calling agent then redeploys the artifact at the URL stored
 * in state.json meta.dashboardUrl (pass it as `url:` so the link is stable
 * across sessions).
 *
 * state.json shape:
 * {
 *   "meta": { "dashboardUrl": "https://claude.ai/code/artifact/…" | null },
 *   "run": {
 *     "id": "ship-2026-07-11-widget",
 *     "title": "Xavier widget",
 *     "kind": "ship" | "build" | "triage",
 *     "build": 24,                       // TestFlight build no. (or null)
 *     "startedAt": "2026-07-11T02:00:00Z",
 *     "stages": [
 *       { "id": "spec", "label": "Spec", "status": "passed",
 *         "note": "user approved", "at": "…ISO…" },
 *       …status: "pending" | "running" | "passed" | "failed" | "blocked"
 *        | "waiting"   (waiting = needs the user, e.g. device confirm)
 *     ],
 *     "checks": { "tests": "338/338", "typecheck": "ok", "lint": "ok" } | null
 *   },
 *   "history": [ { "id", "title", "build", "outcome": "shipped|failed|aborted",
 *                  "finishedAt", "note" } … newest first, keep ≤ 12 ]
 * }
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
const { run, history = [] } = state;

const C = {
  bg: '#0E1116', surface: '#171B22', surfaceAlt: '#1F2530', text: '#F2F5F9',
  muted: '#9AA4B2', primary: '#5B8DEF', primary2: '#7C5BEF',
  positive: '#33C27F', negative: '#F2637E', amber: '#E0884B',
  border: '#2A313C', borderAccent: '#33406E',
};
const STATUS = {
  passed:  { dot: C.positive, label: 'PASSED' },
  running: { dot: C.primary,  label: 'RUNNING' },
  failed:  { dot: C.negative, label: 'FAILED' },
  blocked: { dot: C.negative, label: 'BLOCKED' },
  waiting: { dot: C.amber,    label: 'WAITING ON YOU' },
  pending: { dot: '#3A414D',  label: 'PENDING' },
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (iso) => iso
  ? new Date(iso).toLocaleString('en-SG', { timeZone: 'Asia/Singapore',
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '';

const gateHint = (stages) => {
  const failed = stages.find((s) => s.status === 'failed' || s.status === 'blocked');
  if (failed) return { color: C.negative, text: `Gate closed at ${failed.label} — nothing advances until it passes.` };
  const waiting = stages.find((s) => s.status === 'waiting');
  if (waiting) return { color: C.amber, text: `${waiting.label}: needs you.` };
  const running = stages.find((s) => s.status === 'running');
  if (running) return { color: C.primary, text: `${running.label} in progress…` };
  if (stages.length && stages.every((s) => s.status === 'passed'))
    return { color: C.positive, text: 'All gates passed.' };
  return { color: C.muted, text: 'Idle.' };
};

const stageRows = (run?.stages ?? []).map((s, i, arr) => {
  const st = STATUS[s.status] ?? STATUS.pending;
  const connector = i < arr.length - 1
    ? `<div style="width:2px;flex:1;min-height:14px;background:${s.status === 'passed' ? C.positive : C.border};margin-left:7px"></div>`
    : '';
  return `
  <div style="display:flex;gap:14px">
    <div style="display:flex;flex-direction:column;align-items:flex-start">
      <div style="width:16px;height:16px;border-radius:50%;background:${st.dot};
        ${s.status === 'running' ? `box-shadow:0 0 0 4px ${C.primary}33;` : ''}"></div>
      ${connector}
    </div>
    <div style="padding-bottom:16px;flex:1;min-width:0">
      <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
        <span style="font-weight:700;color:${C.text}">${esc(s.label)}</span>
        <span style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.08em;color:${st.dot}">${st.label}</span>
        <span style="font-size:11px;color:${C.muted}">${fmtTime(s.at)}</span>
      </div>
      ${s.note ? `<div style="font-size:13px;color:${C.muted};margin-top:3px">${esc(s.note)}</div>` : ''}
    </div>
  </div>`;
}).join('');

const checks = run?.checks
  ? Object.entries(run.checks).map(([k, v]) =>
      `<span style="background:${C.surfaceAlt};border:1px solid ${C.border};border-radius:999px;
        padding:4px 12px;font-size:12px;color:${C.text}">
        <span style="color:${C.muted}">${esc(k)}</span> ${esc(v)}</span>`).join(' ')
  : '';

const historyRows = history.slice(0, 12).map((h) => `
  <tr>
    <td style="padding:8px 12px;border-top:1px solid ${C.border};color:${C.text}">${esc(h.title)}</td>
    <td style="padding:8px 12px;border-top:1px solid ${C.border};color:${C.muted};font-variant-numeric:tabular-nums">${h.build ?? '—'}</td>
    <td style="padding:8px 12px;border-top:1px solid ${C.border};
      color:${h.outcome === 'shipped' ? C.positive : h.outcome === 'failed' ? C.negative : C.muted}">${esc(h.outcome)}</td>
    <td style="padding:8px 12px;border-top:1px solid ${C.border};color:${C.muted};font-size:12px">${fmtTime(h.finishedAt)}</td>
    <td style="padding:8px 12px;border-top:1px solid ${C.border};color:${C.muted};font-size:12px">${esc(h.note ?? '')}</td>
  </tr>`).join('');

const hint = gateHint(run?.stages ?? []);

const html = `<title>Xavier pipeline</title>
<style>
  body{background:${C.bg};color:${C.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    margin:0;padding:32px 20px;line-height:1.5}
  .wrap{max-width:760px;margin:0 auto}
  h1{font-size:20px;margin:0}
</style>
<div class="wrap">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
    <div style="width:34px;height:34px;border-radius:50%;
      background:radial-gradient(120% 120% at 30% 22%, #6f9bf2, ${C.primary} 42%, #4570c9)"></div>
    <h1>ProjectXavier — pipeline</h1>
  </div>
  <div style="color:${C.muted};font-size:13px;margin-bottom:24px">
    Stage-gated: every stage must pass before the next runs.
  </div>

  ${run ? `
  <div style="background:${C.surface};border:1px solid ${C.borderAccent};border-radius:16px;padding:20px 22px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
      <div>
        <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${C.muted}">
          ${esc(run.kind)} · started ${fmtTime(run.startedAt)}</div>
        <div style="font-size:18px;font-weight:800;margin-top:2px">${esc(run.title)}</div>
      </div>
      ${run.build ? `<div style="font-family:ui-monospace,monospace;color:${C.primary};font-weight:700">build ${run.build}</div>` : ''}
    </div>
    ${run.audit ? (() => {
      const ok = run.audit.status === 'confirmed';
      const col = ok ? C.positive : C.negative;
      return `<div style="display:inline-flex;align-items:center;gap:7px;margin-top:10px;
        padding:4px 12px;border-radius:999px;border:1px solid ${col}66;background:${col}1a;
        font-size:12px;font-weight:700;color:${col}">
        ${ok ? 'AUDIT: CONFIRMED' : 'AUDIT: DISCREPANCIES'}
        <span style="font-weight:400;color:${C.muted}">${esc(run.audit.note ?? '')} · ${fmtTime(run.audit.at)}</span>
      </div>`;
    })() : ''}
    <div style="margin:14px 0 18px;padding:10px 14px;border-radius:10px;background:${hint.color}1a;
      border:1px solid ${hint.color}55;color:${hint.color};font-size:13px;font-weight:600">${esc(hint.text)}</div>
    ${stageRows}
    ${checks ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">${checks}</div>` : ''}
  </div>` : `<div style="color:${C.muted}">No active run.</div>`}

  <h1 style="margin:32px 0 10px;font-size:15px;color:${C.muted};text-transform:uppercase;letter-spacing:.08em">Recent runs</h1>
  <div style="background:${C.surface};border:1px solid ${C.border};border-radius:12px;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr>${['Feature', 'Build', 'Outcome', 'Finished', 'Note'].map((h) =>
        `<th style="text-align:left;padding:10px 12px;font-size:11px;letter-spacing:.08em;
          text-transform:uppercase;color:${C.muted}">${h}</th>`).join('')}</tr>
      ${historyRows || `<tr><td colspan="5" style="padding:12px;color:${C.muted}">None yet.</td></tr>`}
    </table>
  </div>
  <div style="color:${C.muted};font-size:11px;margin-top:18px">
    Rendered ${fmtTime(new Date().toISOString())} SGT · .claude/pipeline/render.mjs
  </div>
</div>`;

writeFileSync(join(dir, 'dashboard.html'), html);
console.log('rendered dashboard.html');
