# Report Format — qa-report.json schema & Jira posting

Phase 7 writes `qa-report.json` first — it is the single source of truth.
`.github/skills/qa-agent/scripts/build-report.mjs` renders it into the
self-contained `qa-report.html` deliverable, and `jira-mcp/post_qa_report`
reads the same file to build the posted Jira comment. **Nothing hand-authors
HTML or a Markdown comment** — write the JSON correctly and both outputs
follow from it.

Every field below is verified directly against what `build-report.mjs` and
`jira-mcp-server.mjs` actually read — not aspirational.

---

## Top-level schema

```json
{
  "ticketId": "SCRUM-1",
  "title": "Dealer locator mobile viewport fixes",
  "featureSummary": "One sentence — what this ticket changes",
  "locale": "en-us",
  "viewport": "Mobile (360×640)",
  "testDate": "2026-08-31",
  "targetUrl": "https://www.michelinman.com/auto/dealer-locator",

  "verdict": "REJECTED",
  "conclusion": "One-paragraph summary shown directly under the verdict panel — lead with the worst finding.",

  "summary": { "total": 17, "passed": 13, "failed": 3, "partial": 1, "skipped": 0 },

  "acceptanceCriteria": [
    { "id": "AC-1", "requirement": "quoted literally from the ticket", "testCases": ["S4"], "status": "NOT MET" }
  ],

  "commentScenarios": [
    { "source": "Jira comment", "number": 1, "summary": "scenario text from the comment", "testCase": "S9", "status": "PASS", "notes": "one-line result" }
  ],

  "scenarios": [ /* see below */ ],
  "bugs": [ /* see below */ ],

  "analytics": { "testCase": "TC-AN1", "action": "what interaction was tested", "status": "PASS", "evidence": "what you actually observed" },
  "consoleErrors": ["one string per distinct error"],
  "networkFailures": ["one string per 4xx/5xx worth noting"],

  "viewportSummary": [
    { "viewport": "Desktop (1280×800)", "tested": true, "issuesFound": 0 }
  ],

  "regressionInventory": [ /* see below */ ],
  "automationGap": { /* see below — full schema in gherkin-and-gaps.md */ },
  "observations": ["one string per observation — omit the array entirely if there's nothing to note"],

  "videoFull": "videos/SCRUM-1_en-us_full.webm",
  "videoFullMp4": "videos/SCRUM-1_en-us_full.mp4",
  "videoClip": null,
  "featureFile": "SCRUM-1.feature",

  "runType": "delta",
  "deltaScope": "AC-3"
}
```

`runType`/`deltaScope` are only present for a Phase D delta retest (see
`execution.md` § Phase D) — omit both entirely on a normal full run.

---

## `scenarios[]`

```json
{
  "id": "S4",
  "name": "Top-cities list exposes more than 5 cities",
  "type": "Feature",
  "acCoverage": "AC-1",
  "viewport": "Mobile (360×640)",
  "status": "FAIL",
  "steps": ["Load the dealer locator page", "Read all .dl__top-cities-list a entries"],
  "expected": "More than 5 cities listed, per AC-1.",
  "actual": "Exactly 5 in both the original and fresh-context checks.",
  "screenshots": ["images/ss_SCRUM-1_en-us_S4_top-cities.png"]
}
```

`type` is one of `Sanity` / `Feature` / `Boundary` / `Regression` / `Analytics`
(matches `references/execution.md`'s test type matrix). `status` is
`PASS` / `FAIL` / `PARTIAL` / `SKIPPED`. `acCoverage` is omitted for scenarios
that don't map to a specific AC (sanity checks, regression entries).

## `bugs[]`

```json
{
  "id": "BUG-1",
  "title": "Top-cities list exposes only 5 cities — AC-1 not met",
  "severity": "CRITICAL",
  "confidence": "HIGH",
  "scenario": "S4",
  "url": "https://www.michelinman.com/auto/dealer-locator",
  "steps": ["Load the dealer locator page", "Read all .dl__top-cities-list a entries", "Repeat in a fresh context"],
  "expected": "More than 5 cities listed, per AC-1.",
  "actual": "Exactly 5 in both the original and fresh-context checks.",
  "impact": "One sentence — who this actually affects and how.",
  "screenshots": ["images/ss_SCRUM-1_en-us_bug1_top-cities.png"]
}
```

`scenario` must reference a scenario actually marked `FAIL` or `PARTIAL` —
`build-report.mjs` validates this and warns if it doesn't match. `confidence`
is not self-assessed — see `references/testing-rules.md`'s Bug Verification
Protocol for exactly what `HIGH` / `MEDIUM` / `LOW` each require.
`screenshots` is optional but expected for any bug the HTML report should show
evidence for.

## `regressionInventory[]`

```json
{ "widget": "top-cities scroller", "selector": ".dl__top-cities-list", "action": "scroll into view and tap each city", "tested": true, "result": "all 5 cities tapped, each navigated correctly" }
```

Every entry starts `tested: false` during planning; `result` stays empty until
executed. An entry that genuinely can't be exercised keeps `tested: false`
with `result: "SKIPPED — <specific reason>"` — never leave it blank.

## `automationGap`

Full schema and worked example: `references/gherkin-and-gaps.md`. Summary of
the fields `build-report.mjs` renders:

```json
{
  "recommendation": "one paragraph — the overall gap-closing pitch",
  "existingCoverage": ["features/dealer-locator.feature — 4 scenarios: ..."],
  "missingScenarios": [{ "scenario": "S9", "summary": "...", "priority": "HIGH", "declaredGap": true }],
  "missingSteps": [{ "step": "I select the {string} sort option", "belongsIn": "steps/dealer-locator.steps.js" }],
  "missingRegistry": [{ "name": "sort control", "kind": "element", "suggestedSelector": "role=button[name=/sort by/i]" }]
}
```

`coveredByExisting` (scenario IDs already automated) also belongs in this
object per `gherkin-and-gaps.md` — included there, not duplicated here to
avoid the two docs drifting apart.

---

## Verdict → icon/label mapping

| Verdict | Panel | Label |
|---|---|---|
| Zero bugs | ✅ APPROVED | `qa::passed` |
| MINOR only | ✅ APPROVED (with notes) | `qa::conditional` |
| Any MAJOR (incl. any i18n gap) | 🟡 CONDITIONAL APPROVAL | `qa::conditional` |
| Any BLOCKER or CRITICAL | 🔴 REJECTED | `qa::failed` |
| Environment down | 🔵 BLOCKED | `qa::blocked` |

Full severity definitions and verdict-honesty rules:
`references/testing-rules.md`.

---

## What the posted Jira comment actually contains

`post_qa_report` builds a native ADF comment directly from this JSON — there
is no Markdown template to fill in; Jira does not render Markdown syntax
regardless. The comment is **text-only**:

- Heading + locale/viewport/date line + target URL
- Verdict panel + `conclusion`
- Summary table, acceptance criteria table, comment-scenario table (when
  `commentScenarios` is non-empty), scenarios-executed table
- Bug reports — heading, URL, **"Steps to Reproduce:" as a numbered list**,
  Expected, Actual, Console errors if present
- Observations as a bullet list (section omitted entirely if empty)
- Closing lines confirming which of the three attachments below actually
  landed

**No screenshots or video are embedded inline in the comment.** They live in
the self-contained `qa-report.html` (screenshots and video base64-embedded
directly in it) and in the separately-attached video file — duplicating them
in the comment would just be the same evidence twice. An oversized video
(over the embed cap) is never left as a silently-broken link in the HTML
either — the report says in plain text where to actually find it.

## Posting to Jira

```json
{ "ticket_id": "SCRUM-1", "report_path": "qa-runs/SCRUM-1-YYYY-MM-DD-HHMM/qa-report.json" }
```

`post_qa_report` attaches three things when their paths exist and resolve —
`qa-report.html`, the raw session video, and the generated `.feature`
file — then posts the one text-only comment described above. Skip any of the
three independently with `attach_html_report: false`, `attach_video: false`,
or `attach_feature_file: false`. There is no `upload_evidence` flag — that
name belonged to a different, earlier version of this tool.

For a comment that doesn't map onto an existing `qa-report.json` (an ad-hoc
delta retest, most commonly), fall back to `jira-mcp/upload_screenshots` +
`jira-mcp/post_qa_summary`, or `jira-mcp/add_comment` with a hand-built `adf`
object for anything simpler — see `SKILL.md`'s close-out section.
