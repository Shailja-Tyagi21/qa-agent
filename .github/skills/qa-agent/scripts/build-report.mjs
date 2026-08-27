#!/usr/bin/env node
/**
 * build-report.mjs — renders qa-report.html from qa-report.json
 *
 *   node scripts/build-report.mjs <path/to/qa-report.json> [--open]
 *
 * The agent writes JSON only. This renders it, so every report looks identical,
 * structural mistakes are caught mechanically, and the design is one file to fix.
 *
 * Validates before rendering and prints warnings for:
 *   - summary counts that disagree with the scenario list
 *   - bugs with no matching FAIL scenario
 *   - inventory entries left untested with no skip reason
 *   - screenshot/video paths that do not exist on disk
 *
 * Exits 1 on hard errors (bad JSON, missing file), 0 with warnings otherwise.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';

const [, , jsonArg] = process.argv;
if (!jsonArg) {
  console.error('Usage: node build-report.mjs <path/to/qa-report.json>');
  process.exit(1);
}

const jsonPath = resolve(process.cwd(), jsonArg);
if (!existsSync(jsonPath)) {
  console.error(`Not found: ${jsonPath}`);
  process.exit(1);
}

const runDir = dirname(jsonPath);
let R;
try {
  R = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (e) {
  console.error(`Invalid JSON: ${e.message}`);
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const arr = (x) => (Array.isArray(x) ? x : []);
const has = (x) => arr(x).length > 0;
const warn = (m) => warnings.push(m);
const warnings = [];

// ── validation ───────────────────────────────────────────────────────────────
const scenarios = arr(R.scenarios);
const bugs = arr(R.bugs);
const inventory = arr(R.regressionInventory);

const counted = {
  total: scenarios.length,
  passed: scenarios.filter(s => s.status === 'PASS').length,
  failed: scenarios.filter(s => s.status === 'FAIL').length,
  partial: scenarios.filter(s => s.status === 'PARTIAL').length,
  skipped: scenarios.filter(s => s.status === 'SKIP').length,
};
const S = R.summary || {};
for (const k of Object.keys(counted)) {
  if (S[k] !== undefined && S[k] !== counted[k]) {
    warn(`summary.${k} says ${S[k]} but the scenario list has ${counted[k]} — using the actual count`);
  }
}
R.summary = { ...S, ...counted, bugs: S.bugs || {} };

inventory.forEach((e, i) => {
  if (!e.tested && !/^SKIPPED/i.test(e.result || '')) {
  }
});

const failIds = new Set(scenarios.filter(s => s.status === 'FAIL').map(s => s.id));
bugs.forEach(b => {
  if (b.scenario && !failIds.has(b.scenario)) {
    warn(`${b.id || b.title}: linked scenario ${b.scenario} is not marked FAIL`);
  }
  if (!b.scenario) warn(`${b.id || b.title}: no linked scenario`);
});

const checkMedia = (p, label) => {
  if (!p) return;
  if (!existsSync(join(runDir, p))) warn(`${label}: missing on disk — ${p}`);
};
scenarios.forEach(s => arr(s.screenshots).forEach(p => checkMedia(p, s.id)));
bugs.forEach(b => arr(b.screenshots).forEach(p => checkMedia(p, b.id || b.title)));
[R.videoFull, R.videoFullMp4, R.videoClip].forEach(v => checkMedia(v, 'video'));
if (!R.videoFull && !R.videoClip) warn('no video recorded — video evidence is mandatory');

// ── presentation maps ────────────────────────────────────────────────────────
const VERDICT = {
  APPROVED:    { cls: 'v-ok',   icon: '✅', label: 'APPROVED' },
  CONDITIONAL: { cls: 'v-warn', icon: '🟡', label: 'CONDITIONAL APPROVAL' },
  REJECTED:    { cls: 'v-bad',  icon: '🔴', label: 'REJECTED' },
  BLOCKED:     { cls: 'v-info', icon: '🔵', label: 'BLOCKED' },
};
const verdict = VERDICT[(R.verdict || '').toUpperCase()] || VERDICT.BLOCKED;
const statusBadge = (s) => {
  const m = { PASS: 'b-pass', FAIL: 'b-fail', PARTIAL: 'b-part', SKIP: 'b-skip' };
  return `<span class="badge ${m[s] || 'b-skip'}">${esc(s)}</span>`;
};
const sevClass = (s) => `sev-${String(s || 'minor').toLowerCase()}`;
const acBadge = (s) => {
  const m = { MET: 'b-pass', 'NOT MET': 'b-fail', PARTIAL: 'b-part', 'NOT TESTED': 'b-skip' };
  return `<span class="badge ${m[s] || 'b-skip'}">${esc(s)}</span>`;
};

const section = (title, body) => (body ? `<section><h2>${title}</h2>${body}</section>` : '');

// Screenshots (and, size permitting, videos) are embedded as base64 data URIs
// rather than left as "images/…png" relative paths. The relative-path form
// only resolves when the images/ folder travels alongside the .html file —
// which breaks the moment this report is attached to Jira on its own and
// downloaded standalone (Jira's Attachments panel has no folder structure,
// so "download all" flattens everything). A self-contained file has no such
// dependency. Falls back to the relative path only if the source file is
// missing or over the size cap, so a broken/huge run still produces a report
// rather than failing the build.
const MAX_INLINE_VIDEO_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const embedIfSmallEnough = (relPath, mime, maxBytes) => {
  if (!relPath) return null;
  const abs = resolve(runDir, relPath);
  if (!existsSync(abs)) return null;
  try {
    if (statSync(abs).size > maxBytes) return null;
    return `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
  } catch {
    return null;
  }
};

const shots = (list, alt) => arr(list)
  .map(p => {
    const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
    const dataUri = embedIfSmallEnough(p, IMAGE_MIME[ext] || 'image/png', 5 * 1024 * 1024);
    const src = dataUri || p; // falls back to the relative path — only viewable
                              // then if images/ is kept alongside this file
    return `<figure><img src="${src}" alt="${esc(alt)}" loading="lazy"><figcaption>${esc(p.split('/').pop())}</figcaption></figure>`;
  })
  .join('');

// ── sections ─────────────────────────────────────────────────────────────────
const summaryTable = `
<table class="grid">
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Total scenarios</td><td>${R.summary.total}</td></tr>
  <tr><td>Passed</td><td>${R.summary.passed}</td></tr>
  <tr><td>Failed</td><td>${R.summary.failed}</td></tr>
  <tr><td>Partial</td><td>${R.summary.partial}</td></tr>
  <tr><td>Skipped</td><td>${R.summary.skipped}</td></tr>
  <tr><td>Bugs found</td><td>${bugs.length}${bugs.length ? ' — ' + ['BLOCKER','CRITICAL','MAJOR','MINOR']
      .map(s => `${bugs.filter(b => (b.severity||'').toUpperCase() === s).length} ${s}`)
      .filter(x => !x.startsWith('0 ')).join(', ') : ''}</td></tr>
</table>`;

const acTable = has(R.acceptanceCriteria) ? `
<table class="grid">
  <tr><th>AC</th><th>Requirement</th><th>Covered by</th><th>Status</th></tr>
  ${arr(R.acceptanceCriteria).map(a => `<tr>
    <td><code>${esc(a.id)}</code></td><td>${esc(a.requirement)}</td>
    <td>${esc(arr(a.testCases).join(', ') || '—')}</td><td>${acBadge(a.status)}</td></tr>`).join('')}
</table>` : '';

const commentTable = has(R.commentScenarios) ? `
<p class="note">Scenarios found only in the ticket comment thread. Each is tracked separately.</p>
<table class="grid">
  <tr><th>Source</th><th>#</th><th>Scenario</th><th>Test case</th><th>Status</th><th>Notes</th></tr>
  ${arr(R.commentScenarios).map(c => `<tr>
    <td>${esc(c.source)}</td><td>${esc(c.number)}</td><td>${esc(c.summary)}</td>
    <td>${esc(c.testCase || '—')}</td><td>${esc(c.status)}</td><td>${esc(c.notes || '')}</td></tr>`).join('')}
</table>` : '';

const scenarioCards = has(scenarios) ? scenarios.map(s => {
  const bug = bugs.find(b => b.scenario === s.id);
  const cls = s.status === 'FAIL' ? `card ${sevClass(bug?.severity || 'major')}` : 'card';
  return `<article class="${cls}">
    <div class="chip-row"><span class="chip-id">${esc(s.id)}</span>
      <span class="chip">${esc(s.type || '—')}</span>
      ${s.acCoverage ? `<span class="chip">${esc(s.acCoverage)}</span>` : ''}
      <span class="chip">${esc(s.viewport || 'Desktop')}</span>
      ${statusBadge(s.status)}</div>
    <h3>${esc(s.name)}</h3>
    <dl>
      <dt>Steps</dt><dd>${arr(s.steps).map(esc).join(' → ') || '—'}</dd>
      <dt>Expected</dt><dd>${esc(s.expected)}</dd>
      <dt>Actual</dt><dd>${esc(s.actual)}</dd>
    </dl>
    <div class="shots">${shots(s.screenshots, s.id)}</div>
  </article>`;
}).join('') : '';

const bugCards = has(bugs) ? bugs.map(b => `
  <article class="card ${sevClass(b.severity)}">
    <div class="chip-row"><span class="chip-id">${esc(b.id || 'BUG')}</span>
      <span class="badge b-fail">${esc(b.severity)}</span>
      <span class="chip">confidence: ${esc(b.confidence || 'HIGH')}</span>
      ${b.scenario ? `<span class="chip">${esc(b.scenario)}</span>` : ''}</div>
    <h3>${esc(b.title)}</h3>
    <dl>
      ${b.url ? `<dt>URL</dt><dd class="mono">${esc(b.url)}</dd>` : ''}
      <dt>Steps</dt><dd>${arr(b.steps).map(esc).join(' → ') || '—'}</dd>
      <dt>Expected</dt><dd>${esc(b.expected)}</dd>
      <dt>Actual</dt><dd>${esc(b.actual)}</dd>
      <dt>Impact</dt><dd>${esc(b.impact)}</dd>
    </dl>
    <div class="shots">${shots(b.screenshots, b.id || 'bug')}</div>
  </article>`).join('') : '<p class="ok">No confirmed bugs.</p>';

const inventoryTable = ''; // regression inventory removed from report
const _inventoryTable_unused = has(inventory) ? `
<table class="grid">
  <tr><th>Widget</th><th>Action</th><th>Exercised</th><th>Result</th></tr>
  ${inventory.map(e => `<tr>
    <td>${esc(e.widget)}<br><code class="dim">${esc(e.selector || '')}</code></td>
    <td>${esc(e.action || '—')}</td>
    <td>${e.tested ? '<span class="badge b-pass">YES</span>' : '<span class="badge b-skip">NO</span>'}</td>
    <td>${esc(e.result)}</td></tr>`).join('')}
</table>` : '';

const analyticsBlock = R.analytics ? `
<p class="dim">What this checks: before the first interaction, the run listens for analytics
requests (GA/GTM/Tealium/Segment) and snapshots <code>window.dataLayer</code>; after one
interaction it compares. PASS means at least one request or dataLayer push fired;
FAIL (MAJOR) means an interaction produced zero analytics signal.</p>
<table class="grid">
  <tr><th>Case</th><th>Action</th><th>Status</th><th>Evidence</th></tr>
  <tr><td><code>${esc(R.analytics.testCase || 'TC-AN1')}</code></td>
      <td>${esc(R.analytics.action)}</td>
      <td>${statusBadge(R.analytics.status)}</td>
      <td>${esc(R.analytics.evidence)}</td></tr>
</table>` : '';

// Renders one automationGap list item whether it's a plain string (older
// report shape) or a structured object (current qa-record.mjs shape) — the
// old `esc(x)` on an object produced literal "[object Object]" rows.
const gapItem = (x) => {
  if (x == null) return '';
  if (typeof x !== 'object') return esc(x);
  if (x.scenario) return `<strong>${esc(x.scenario)}</strong> — ${esc(x.summary || '')}${x.priority ? ` <span class="dim">(${esc(x.priority)})</span>` : ''}`;
  if (x.step) return `<code>${esc(x.step)}</code> <span class="dim">— belongs in ${esc(x.belongsIn || '?')}</span>`;
  if (x.name) return `${esc(x.name)} <span class="dim">(${esc(x.kind || 'element')})</span> — suggested selector <code>${esc(x.suggestedSelector || '')}</code>`;
  return esc(JSON.stringify(x));
};
const gapList = (list, tag = 'ul') => `<${tag}>${arr(list).map(x => `<li>${gapItem(x)}</li>`).join('')}</${tag}>`;

const listBlock = (list) => has(list) ? `<ul>${arr(list).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
const writeup = (list, empty) => has(list) ? listBlock(list) : `<p>${esc(empty)}</p>`;

const viewportTable = has(R.viewportSummary) ? `
<table class="grid">
  <tr><th>Viewport</th><th>Tested</th><th>Issues</th></tr>
  ${arr(R.viewportSummary).map(v => `<tr><td>${esc(v.viewport)}</td>
    <td>${v.tested ? '✅' : '⏭ not required'}</td><td>${esc(v.issuesFound)}</td></tr>`).join('')}
</table>` : '';

const gap = R.automationGap ? `
<p>${esc(R.automationGap.recommendation)}</p>
${has(R.automationGap.existingCoverage) ? `<p class="lbl">Existing coverage</p>${gapList(R.automationGap.existingCoverage)}` : ''}
${has(R.automationGap.missingScenarios) ? `<p class="lbl">Missing — automate these next</p>${gapList(R.automationGap.missingScenarios, 'ol')}` : ''}
${has(R.automationGap.missingSteps) ? `<p class="lbl">Missing step definitions</p>${gapList(R.automationGap.missingSteps)}` : ''}
${has(R.automationGap.missingRegistry) ? `<p class="lbl">Missing page-object registry entries</p>${gapList(R.automationGap.missingRegistry)}` : ''}
${R.featureFile ? `<p class="note">Gherkin scaffold written to <code>${esc(R.featureFile)}</code></p>` : ''}` : '';

const videoBlock = (() => {
  const one = (path, mp4, label) => {
    if (!path) return '';
    const mp4Uri = mp4 ? embedIfSmallEnough(mp4, 'video/mp4', MAX_INLINE_VIDEO_BYTES) : null;
    const webmUri = embedIfSmallEnough(path, 'video/webm', MAX_INLINE_VIDEO_BYTES);
    const embedded = Boolean(mp4Uri || webmUri);
    const sources = [mp4 ? `<source src="${esc(mp4Uri || mp4)}" type="video/mp4">` : '',
                     `<source src="${esc(webmUri || path)}" type="video/webm">`].join('');
    const standaloneNote = embedded ? '' :
      `<p class="dim">Video not embedded (over ${(MAX_INLINE_VIDEO_BYTES / 1024 / 1024).toFixed(0)}MB) —
       keep this file next to <code>${esc(path)}</code> on disk, or grab the video as its own
       Jira attachment, for it to play if this report is opened on its own.</p>`;
    return `<div class="vid"><p class="lbl">${esc(label)}</p>
      <video controls preload="metadata">${sources}</video>${standaloneNote}
      <a class="dl" href="${esc(webmUri || path)}" download>Download ${esc(path.split('/').pop())}</a></div>`;
  };
  return one(R.videoClip, null, 'Focused clip — core flow')
       + one(R.videoFull, R.videoFullMp4, 'Full session recording');
})();

const buildWarnings = warnings.length ? `
<section><h2>Report build warnings</h2>
<div class="card warn"><ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
<p class="note">Emitted by build-report.mjs — these are inconsistencies in the report data, not findings on the site.</p></div></section>` : '';

// ── document ─────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Report — ${esc(R.ticketId)}</title>
<style>
  :root{
    --ink:#12161f; --muted:#5b6472; --line:#e3e7ee; --bg:#f6f8fb; --panel:#fff;
    --ok:#16a34a; --okbg:#e9f9ef; --bad:#dc2626; --badbg:#fdecec;
    --warn:#c2870a; --warnbg:#fff8e6; --info:#2563eb; --infobg:#eaf1fe;
    --crit:#7c3aed;
  }
  *{box-sizing:border-box}
  body{margin:0;padding:32px 20px 64px;background:var(--bg);color:var(--ink);
    font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
  .wrap{max-width:1080px;margin:0 auto}
  h1{font-size:1.55rem;margin:0 0 6px}
  h2{font-size:1.05rem;margin:34px 0 12px;padding-bottom:7px;border-bottom:2px solid var(--line);
    letter-spacing:.02em;text-transform:uppercase;color:#37404f}
  h3{font-size:.98rem;margin:6px 0 10px}
  .meta{color:var(--muted);font-size:.86rem;margin-bottom:18px}
  .meta b{color:var(--ink)}
  .meta a{color:var(--info);text-decoration:none;word-break:break-all}
  .verdict{padding:16px 20px;border-radius:12px;font-weight:600;margin:18px 0 8px;border-left:6px solid}
  .v-ok{background:var(--okbg);border-color:var(--ok);color:#146c33}
  .v-warn{background:var(--warnbg);border-color:var(--warn);color:#8a5d00}
  .v-bad{background:var(--badbg);border-color:var(--bad);color:#9c1c1c}
  .v-info{background:var(--infobg);border-color:var(--info);color:#1b4bab}
  .verdict small{display:block;font-weight:400;margin-top:5px;font-size:.88rem;opacity:.9}
  table.grid{width:100%;border-collapse:collapse;background:var(--panel);border-radius:10px;
    overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.07)}
  table.grid th{background:#232c3a;color:#fff;text-align:left;padding:9px 13px;font-size:.8rem;
    text-transform:uppercase;letter-spacing:.04em}
  table.grid td{padding:9px 13px;font-size:.88rem;border-bottom:1px solid #f1f3f7;vertical-align:top}
  table.grid tr:last-child td{border-bottom:none}
  table.grid tr:nth-child(even) td{background:#fafbfd}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:16px 18px;
    margin-bottom:12px;box-shadow:0 1px 3px rgba(16,24,40,.05);border-left:5px solid var(--line)}
  .card.sev-blocker{border-left-color:var(--bad)}
  .card.sev-critical{border-left-color:var(--crit)}
  .card.sev-major{border-left-color:var(--warn)}
  .card.sev-minor{border-left-color:var(--info)}
  .card.warn{border-left-color:var(--warn);background:var(--warnbg)}
  .chip-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:4px}
  .chip{font-size:.72rem;padding:2px 9px;border-radius:20px;background:#eef1f6;color:#485261}
  .chip-id{font-size:.72rem;font-weight:700;letter-spacing:.06em;padding:2px 9px;border-radius:20px;
    background:#232c3a;color:#fff}
  .badge{font-size:.72rem;font-weight:700;letter-spacing:.05em;padding:2px 9px;border-radius:20px}
  .b-pass{background:var(--okbg);color:var(--ok)} .b-fail{background:var(--badbg);color:var(--bad)}
  .b-part{background:var(--warnbg);color:var(--warn)} .b-skip{background:#eef1f6;color:var(--muted)}
  dl{margin:0;display:grid;grid-template-columns:88px 1fr;gap:3px 12px;font-size:.88rem}
  dt{color:var(--muted);font-weight:600}
  dd{margin:0}
  .shots{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
  figure{margin:0;max-width:340px}
  figure img{width:100%;border:1px solid var(--line);border-radius:7px;display:block;cursor:zoom-in}
  figure img:target,figure img:hover{max-width:none}
  figcaption{font-size:.7rem;color:var(--muted);margin-top:3px;word-break:break-all}
  pre{background:#1b2331;color:#dce3ee;padding:13px 16px;border-radius:9px;font-size:.8rem;
    white-space:pre-wrap;word-break:break-word;margin:0}
  .vid{margin-bottom:18px}
  video{width:100%;max-width:880px;border-radius:9px;background:#000;display:block}
  .dl{display:inline-block;margin-top:6px;font-size:.85rem;color:var(--info);text-decoration:none}
  .lbl{font-weight:600;font-size:.85rem;margin:10px 0 4px}
  .note{font-size:.82rem;color:var(--muted);margin:6px 0}
  .ok{color:var(--ok);font-weight:600}
  .dim{color:var(--muted);font-size:.75rem}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;word-break:break-all}
  code{background:#eef1f6;padding:1px 5px;border-radius:4px;font-size:.85em}
  footer{margin-top:44px;padding-top:14px;border-top:1px solid var(--line);
    font-size:.78rem;color:var(--muted)}
</style></head><body><div class="wrap">

<h1>QA Report — ${esc(R.ticketId)}${R.runType === 'delta' ? ` · delta: ${esc(R.deltaScope)}` : ''}</h1>
<p class="meta">
  <b>Feature:</b> ${esc(R.title || R.featureSummary)}<br>
  <b>Locale:</b> <code>${esc(R.locale)}</code> &nbsp;·&nbsp;
  <b>Viewport:</b> ${esc(R.viewport)} &nbsp;·&nbsp;
  <b>Date:</b> ${esc(R.testDate)}<br>
  <b>Target:</b> <a href="${esc(R.targetUrl)}">${esc(R.targetUrl)}</a>
  ${R.jiraUrl ? `<br><b>Ticket:</b> <a href="${esc(R.jiraUrl)}">${esc(R.ticketId)}</a>` : ''}
  ${R.mrUrl ? ` &nbsp;·&nbsp; <b>MR:</b> <a href="${esc(R.mrUrl)}">${esc(R.mrUrl)}</a>` : ''}
</p>

<div class="verdict ${verdict.cls}">${verdict.icon} QA VERDICT: ${verdict.label}
  <small>${esc(R.conclusion || '')}</small></div>

${section('Summary', summaryTable)}
${R.featureSummary && R.featureSummary !== R.title ? section('What was tested', `<div class="card"><p>${esc(R.featureSummary)}</p>${R.mrChangeSummary ? `<p class="note">${esc(R.mrChangeSummary)}</p>` : ''}</div>`) : ''}
${section('Acceptance criteria coverage', acTable)}
${section('Comment scenario coverage', commentTable)}
${section('Scenarios executed', scenarioCards)}
${section('Bug reports', bugCards)}

${section('Analytics', analyticsBlock)}
${section('Console errors', `<p class="dim">What this checks: the browser console is watched for new JS errors across
every page visited (zero tolerance) — an error is only excluded if it also fires on a clean
load with no test actions, which is noted below when that's the case.</p>${writeup(R.consoleErrors, 'No console errors detected.')}`)}
${section('Network failures', `<p class="dim">What this checks: every 4xx/5xx response during the run. First-party failures
that break visible behaviour are reported as bugs; third-party or analytics-endpoint failures
with no visible UI impact are listed here for awareness, not raised as bugs.</p>${writeup(R.networkFailures, 'No network failures detected.')}`)}
${section('Viewport summary', viewportTable)}
${section('Automation gap analysis', gap)}
${section('Observations', listBlock(R.observations))}
${section('Warnings', listBlock(R.warnings))}
${section('Video evidence', videoBlock || '<p class="note">No video recorded.</p>')}
${buildWarnings}

<footer>Generated by QA Agent (autonomous) · ${esc(R.ticketId)} · <code>${esc(R.locale)}</code> · ${esc(R.viewport)} · ${esc(R.testDate)}</footer>
</div></body></html>`;

const outPath = join(runDir, 'qa-report.html');
writeFileSync(outPath, html, 'utf8');

console.log(`\n✅ Report written: ${outPath}`);
console.log(`   ${R.summary.total} scenarios · ${R.summary.passed} pass · ${R.summary.failed} fail · ${bugs.length} bugs · verdict ${verdict.label}`);
if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} build warning(s) — also shown at the bottom of the report:`);
  warnings.forEach(w => console.log(`   • ${w}`));
}
console.log('');
