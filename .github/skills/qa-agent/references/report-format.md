# Report Format

`qa-report.json` is the single source of truth. The HTML is **generated from it**
by `scripts/build-report.mjs` — never hand-authored.

```bash
node scripts/build-report.mjs qa-runs/{ticketId}-{stamp}/qa-report.json
# → writes qa-report.html in the same folder
```

Why this way: hand-writing a 300-line HTML template per run is slow, burns
context, and drifts between runs. Generating it means every report looks
identical, the pre-flight can validate structure mechanically, and fixing the
report design is a one-file change instead of a prompt rewrite.

---

## JSON schema

All media paths are **relative to the run folder** so the folder can be zipped
and opened anywhere.

```json
{
  "ticketId": "SCRUM-1",
  "runType": "full",
  "deltaScope": null,
  "title": "Ticket title from Jira",
  "jiraUrl": "https://.../browse/SCRUM-1",
  "mrUrl": null,
  "targetUrl": "https://www.michelinman.com/auto/dealer-locator",
  "locale": "en-us",
  "viewport": "Desktop 1280x800",
  "testDate": "2026-08-20",
  "featureSummary": "One sentence — what this ticket changes.",
  "mrChangeSummary": "Optional — what changed in code and the regression risk it creates.",

  "acceptanceCriteria": [
    { "id": "AC-1", "requirement": "Verbatim text from the ticket", "status": "MET", "testCases": ["S3", "S4"] }
  ],

  "commentScenarios": [
    { "source": "Jira comment", "number": 1, "summary": "Scenario as written in the comment", "testCase": "S7", "status": "COVERED", "notes": "" }
  ],

  "scenarios": [
    {
      "id": "S1",
      "type": "Sanity",
      "name": "Page loads with correct title and hero image",
      "acCoverage": "AC-1",
      "viewport": "Desktop",
      "steps": ["Navigated to targetUrl", "Verified h1 and hero img"],
      "expected": "Page loads, title and hero visible, no console errors",
      "actual": "h1 confirmed, hero img rendered, console clean",
      "status": "PASS",
      "screenshots": ["images/ss_SCRUM-1_en-us_S1_page-load.png"]
    }
  ],

  "bugs": [
    {
      "id": "BUG-1",
      "title": "Short descriptive title",
      "severity": "MAJOR",
      "confidence": "HIGH",
      "scenario": "S9",
      "url": "https://…",
      "steps": ["Step 1", "Step 2"],
      "expected": "…",
      "actual": "…",
      "impact": "…",
      "screenshots": ["images/ss_SCRUM-1_en-us_bug1_slug.png"]
    }
  ],

  "regressionInventory": [
    { "widget": "…", "selector": "…", "action": "…", "tested": true,  "result": "What actually happened when exercised" },
    { "widget": "…", "selector": "…", "action": "…", "tested": false, "result": "SKIPPED — requires authenticated session" }
  ],

  "analytics": {
    "testCase": "TC-AN1",
    "action": "Clicked primary hero CTA",
    "status": "PASS",
    "evidence": "3 dataLayer pushes captured; 1 GTM collect request 200"
  },

  "consoleErrors": ["Verbatim error text", "…"],
  "networkFailures": ["404 https://…/asset.svg"],
  "observations": ["CDL-214 appears resolved — sort panel now opens", "…"],
  "warnings": ["Consent banner took 3 attempts to dismiss"],

  "viewportSummary": [
    { "viewport": "Desktop (1280x800)", "tested": true,  "issuesFound": "1 MAJOR" },
    { "viewport": "Mobile (390x844)",   "tested": false, "issuesFound": "N/A" },
    { "viewport": "Tablet (768x1024)",  "tested": false, "issuesFound": "N/A" }
  ],

  "automationGap": {
    "existingCoverage": ["path/to/existing.feature — covers en-us only"],
    "missingScenarios": ["Verify dealer card CTA navigates to detail page"],
    "recommendation": "No en-us coverage for dealer locator — 3 scenarios missing."
  },

  "summary": {
    "total": 14, "passed": 12, "failed": 1, "partial": 1, "skipped": 0,
    "bugs": { "total": 1, "blocker": 0, "critical": 0, "major": 1, "minor": 0 }
  },

  "videoFull": "videos/SCRUM-1_en-us_full.webm",
  "videoFullMp4": "videos/SCRUM-1_en-us_full.mp4",
  "videoClip": null,
  "featureFile": "SCRUM-1.feature",
  "verdict": "CONDITIONAL",
  "conclusion": "12 of 14 scenarios passed. 1 MAJOR bug — localisation gap on the sort control."
}
```

---

## Field rules

- `scenarios[].id` — sequential `S1, S2, S3…` across all types, no type prefixes
- `scenarios[].type` — one of `Sanity`, `Feature`, `Comment`, `Boundary`, `Regression`, `Analytics`
- `scenarios[].status` — `PASS` | `FAIL` | `PARTIAL` | `SKIP`
- **A scenario that uncovered a confirmed bug is `FAIL`, never `PASS`.** Every
  entry in `bugs[]` must name a `scenario` that is `FAIL`. They are linked.
- `summary.failed` must equal the count of `FAIL` scenarios, and
  `passed = total − failed − partial − skipped`. The builder will warn if not.
- `severity` — `BLOCKER` | `CRITICAL` | `MAJOR` | `MINOR`
- `confidence` — `HIGH` (reproduced 2×, recheck gate passed) | `MEDIUM`
  (reproduced but environment-specific) | `LOW` → do not list it as a bug, move it
  to `observations[]`
- Bug screenshots are dedicated files — never a scenario screenshot reused
- `acceptanceCriteria[].status` — `MET` | `NOT MET` | `PARTIAL` | `NOT TESTED`
  (`NOT TESTED` requires a reason in `warnings[]`)
- `regressionInventory` must be non-empty; every entry is `tested:true` or has a
  `result` beginning `SKIPPED —`
- `automationGap` is always populated, even when it is just "no automation exists"
- `videoFull` is required; `videoClip` and `videoFullMp4` may be `null`
- `verdict` — `APPROVED` | `CONDITIONAL` | `REJECTED` | `BLOCKED`
- Never put credentials, internal hostnames or tokens in any field, including
  `targetUrl` — strip basic-auth prefixes before writing

---

## What the generated HTML contains

In order: header with ticket metadata → verdict banner → summary table →
acceptance-criteria coverage → comment-scenario coverage (omitted when empty) →
scenario cards with inline screenshots → bug cards (severity-coloured, omitted
when empty) → regression inventory table → analytics result → console errors →
network failures → viewport summary → automation gap → observations and warnings
→ video player with download links → footer.

Sections with no data are omitted rather than left showing an empty placeholder.
