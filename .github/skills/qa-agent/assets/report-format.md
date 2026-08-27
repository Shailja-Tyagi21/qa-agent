# Jira Comment Format — QA Agent Report

This is the source layout for the QA report. The Jira MCP `post_qa_report` tool reads
`qa-report.json`, uploads the rendered report and evidence files, and converts the
sections below to native Atlassian Document Format (ADF). Do not send this Markdown
template directly to Jira: Jira does not render Markdown syntax as formatting.
Fill in every `{placeholder}`. Do not leave any section empty.

---

```markdown
## 🤖 Copilot QA Report — MR !{mr_iid} (Jira: {ticket_id})

**Feature:** {feature title}
**Locale tested:** {locale}
**Viewport:** {Desktop (1280×800) | Mobile (360×640) | Tablet (768×1024)}
**Environment:** {staging URL}
**Jira Ticket:** [{ticket_id}]({jira_url})
**Date:** {YYYY-MM-DD}

---

### {✅ | 🔴 | 🟡 | 🔵} QA VERDICT: {APPROVED | REJECTED | CONDITIONAL APPROVAL | BLOCKED}

| Metric | Count |
|--------|-------|
| Total Test Cases | {n} |
| ✅ Passed | {n} |
| 🔴 Failed | {n} |
| 🟡 Partial | {n} |
| ⏭️ Skipped | {n} |
| 🐛 Bugs Found | {n} — {x} BLOCKER, {x} CRITICAL, {x} MAJOR, {x} MINOR |

---

### 🧪 SANITY TEST RESULTS

| # | Test Case | Viewport | Status | Notes |
|---|-----------|----------|--------|-------|
| TC-S1 | {title} | Desktop | ✅ PASS | |
| TC-S2 | {title} | Desktop | 🔴 FAIL | See BUG-001 |

---

### 🔬 FEATURE TEST RESULTS (including Boundary & Page-Context tests)

| # | Test Case | AC Coverage | Viewport | Status | Notes |
|---|-----------|-------------|----------|--------|-------|
| TC-F1 | {title — happy path} | AC-1 | Desktop | ✅ PASS | |
| TC-F2 | {title — boundary: empty state} | AC-1 | Desktop | ✅ PASS | 0 results handled gracefully |
| TC-F3 | {title — boundary: URL param} | AC-2 | Desktop | 🔴 FAIL | See BUG-002 |
| TC-B1 | {title — back button} | — | Desktop | ✅ PASS | Previous URL restored |
| TC-P1 | {title — page context: adjacent widget} | — | Desktop | ✅ PASS | Sort panel unaffected |

---

### 🐛 BUG REPORTS

#### BUG-{n} — {title}
**Severity:** {🔴 BLOCKER | 🟠 CRITICAL | 🟡 MAJOR | 🟢 MINOR}
**Area:** {page / feature area}
**URL:** {exact URL}
**Locale:** {locale}

**Steps to Reproduce:**
1. Navigate to {URL}
2. {action}
3. {action}

**Expected:** {expected behaviour}
**Actual:** {actual behaviour}
**Console Errors:** {errors or "None"}

**Screenshot:**
{screenshot attached or linked}

---

### 📋 ACCEPTANCE CRITERIA COVERAGE

| AC # | Requirement | Test Case | Status |
|------|-------------|-----------|--------|
| AC-1 | {text from MR} | TC-F1 | ✅ MET |
| AC-2 | {text from MR} | TC-F3 | 🔴 NOT MET |
| AC-3 | {text from MR} | — | ⏭️ NOT TESTED |

---

### 🧾 COMMENT SCENARIO COVERAGE

> ⚠️ This section is **MANDATORY** whenever MR notes or Jira comments contain scenarios, numbered cases, exact steps, extra AC, or edge cases. Enumerate every distinct scenario found there. Do not merge multiple scenarios into one row.

| Source | Scenario # | Scenario Summary | Test Case | Status | Notes |
|--------|------------|------------------|-----------|--------|-------|
| MR note | 1 | {scenario extracted from MR note/comment} | TC-F4 | ✅ COVERED | {notes} |
| Jira comment | 2 | {scenario extracted from Jira comment} | TC-F5 | 🔴 NOT MET | See BUG-003 |
| Jira comment | 3 | {edge case extracted from Jira comment} | TC-B2 | ⏭️ BLOCKED | {blocked reason} |

---

### 📱 VIEWPORT SUMMARY

| Viewport | Tested | Issues Found |
|----------|--------|--------------|
| Desktop (1280×800) | ✅ | {n bugs or "None"} |
| Mobile (360×640) | {✅ tested / ⏭️ not required} | {n bugs / N/A} |
| Tablet (768×1024) | {✅ tested / ⏭️ not required} | {n bugs / N/A} |

---

### 📸 SCREENSHOT EVIDENCE

> ⚠️ This section is **MANDATORY**. Never leave it empty.

**🎬 Full session recording:**
{markdown_embed for .webm video from record-qa-evidence.js output}

**Baseline — page load:**
{markdown_embed}

**TC-{id} — {description}:**
{markdown_embed}

_{Repeat for every major interaction and all FAILs}_

---

### 💡 OBSERVATIONS

> Include this section **only if there is something worth noting** — Include any of the following that apply:

{UX concerns, design inconsistencies, localisation issues, spelling mistakes, edge cases not in AC,
performance notes, layout issues, broken images/icons, API param mismatches, console warnings,
notes on environment limitations, selector patterns discovered, analytics behaviour, fallback behaviour, unexpected behaviour, UX concerns, analytics anomalies, or anything not captured by a test case result. If there is nothing to observe, omit this section entirely.}

---

> _Tested by: Copilot QA Agent (autonomous) | Jira: {ticket_id} | {locale} locale | {viewport} | {YYYY-MM-DD}_
```

---

## Verdict → Icon mapping

| Verdict | Heading icon | Label |
|---------|-------------|-------|
| All pass, zero bugs | ✅ QA VERDICT: APPROVED | `qa::passed` |
| BLOCKER or CRITICAL found | 🔴 QA VERDICT: REJECTED | `qa::failed` |
| MAJOR found (incl. i18n) | 🟡 QA VERDICT: CONDITIONAL APPROVAL | `qa::conditional` |
| Environment down | 🔵 QA VERDICT: BLOCKED | `qa::blocked` |
| MINOR only | ✅ QA VERDICT: APPROVED (with minor notes) | `qa::conditional` |

See [testing-rules.md](../references/testing-rules.md) for bug severity definitions and verdict honesty rules.

## Posting to Jira

Use `post_qa_report` with the ticket ID and the path to `qa-report.json`:

```json
{
	"ticket_id": "SCRUM-1",
	"report_path": "qa-runs/SCRUM-1-YYYY-MM-DD-HHMM/qa-report.json"
}
```

The tool attaches `qa-report.html`, screenshots, videos, and the generated feature
file when those paths exist, then posts one native ADF comment. Use
`upload_evidence: false` only when the files have already been attached.
