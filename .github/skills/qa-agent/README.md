# QA Agent — autonomous QA agent

Give it a Jira ticket ID. It reads the ticket and its comments, plans a test
suite, drives a real browser while recording, and produces a self-contained HTML
report with embedded video, screenshots, a machine-readable JSON result and a
Gherkin `.feature` scaffold.

```
qa-agent SCRUM-1
qa-agent SCRUM-1 https://www.michelinman.com/auto/dealer-locator   # URL override
qa-agent check: AC-3                                            # delta retest
qa-agent test: <comment on the ticket>                          # explicit marker —
                                                                  # always captured as
                                                                  # its own scenario
```

---

## ⚠️ Read this before you demo

The two source versions this was merged from both contained a **live basic-auth
credential and internal preprod hostnames** hardcoded in their reference files.
Those are stripped here. Two things follow:

1. **Rotate that credential.** It has been sitting in plaintext in two zip files.
2. **Do not re-add it.** Credentials belong in `.env` (see `.env.example`), read
   at runtime. Nothing in `references/` should ever contain a hostname, token or
   password. `references/site-reference.md` is deliberately public-only.

---

## Layout

```
qa-agent/
├── SKILL.md                      # orchestrator — 7 phases, read first
├── references/
│   ├── execution.md              # phases 3–6 in detail + delta path
│   ├── testing-rules.md          # verdicts, severity, boundaries, always/never
│   ├── report-format.md          # qa-report.json schema (source of truth)
│   ├── gherkin-and-gaps.md       # .feature template + automation gap
│   └── site-reference.md         # public michelinman.com paths — no secrets
├── scripts/
│   ├── build-report.mjs           # qa-report.json → self-contained qa-report.html
│   │                               # (screenshots + video embedded as base64;
│   │                               # gracefully falls back to plain text — no
│   │                               # broken player/link — when video is too
│   │                               # large to embed)
│   └── qa-record.mjs              # deterministic recorder / fallback capture,
│                                   # kept specifically as a demo-day safety net
├── assets/steps.example.json
├── agents/openai.yaml
└── .env.example
```

Output per run:

```
qa-runs/SCRUM-1-2026-08-20-1145/
├── qa-report.html      ← the deliverable — self-contained, opens standalone
├── qa-report.json      ← source of truth
├── SCRUM-1.feature     ← copy of features/generated/SCRUM-1.feature, kept
│                          alongside this run's other artefacts
├── evidence-full.json  ← if qa-record.mjs was used
├── images/ss_*.png
└── videos/SCRUM-1_en-us_full.webm
```

---

## Setup

```bash
npm i
```

**No separate browser install step, and no bundled Chromium.** The live site
sits behind Akamai Bot Manager, which hard-blocks headless Chromium outright —
a 403, not a soft failure. Every browser this agent launches uses
`channel: 'chrome'` against a **real, already-installed Google Chrome** on the
machine, via the shared config in the suite's `support/browser.js`. Make sure
Chrome is installed before running anything; `npx playwright install chromium`
would set up a browser this agent never actually uses.

```bash
cp .env.example .env      # fill in JIRA_* only, for the public demo
```

Verify the pipeline works before you rely on it:

```bash
node .github/skills/qa-agent/scripts/qa-record.mjs --ticket DEMO-1 --url https://www.michelinman.com/ --steps smoke
node .github/skills/qa-agent/scripts/build-report.mjs qa-runs/DEMO-1-*/qa-report.json   # after you write the JSON
```

---

## The design decision worth defending

**The agent writes JSON. A script renders the HTML.**

Both source versions had the agent hand-author the report — one a 300-line HTML
template, the other a markdown comment. That is slow, eats context, and
drifts between runs. Here the agent fills a schema and `build-report.mjs` renders
it, which buys three things:

- every report looks identical, run to run
- structural errors are caught mechanically, not by eye — the builder validates
  summary counts against the scenario list, checks that every bug links to a FAIL
  or PARTIAL scenario, flags inventory entries left untested without a reason,
  and stats every screenshot and video path. Warnings print to the console *and*
  appear at the bottom of the report, so a sloppy run is visible rather than
  plausible.
- changing the report design is a one-file edit, not a prompt rewrite

Try it: feed it a JSON with a miscounted summary and a missing screenshot. It
tells you.

A related decision on the reporting side: **`post_qa_report` attaches three
things to the Jira ticket** — the self-contained HTML report, the raw session
video (for quick playback without downloading the larger HTML), and the
generated `.feature` file — then posts a text-only summary comment. Screenshots
and video are never re-embedded inline in the comment itself, since they
already live in those attachments; duplicating them there would just be the
same evidence twice.

---

## Bug reporting is held to a real evidentiary standard, not self-assessment

A bug's `confidence` field means something specific, not "the agent felt sure":

- `HIGH` — reproduced twice in fresh contexts, **and** either the failure is
  self-evidently mechanical (a thrown console error, a literal wrong count, a
  DOM attribute value like `tabindex="-1"` — no causal inference needed), **or**
  a claimed root cause survived an isolating test (disable the suspected
  blocker, retry the interaction, confirm it actually changes the outcome).
- `MEDIUM` — reproduced twice, but a claimed cause is inferred from
  correlation only (e.g. `elementFromPoint` resolving to an unexpected
  element) with no isolating test run — the bug's `actual` field says so
  explicitly rather than presenting a guess as settled fact.
- `LOW` — reproduced once, or the mechanism is genuinely unclear.

This exists because reproducing a bug twice the same (flawed) way just
reproduces the same misleading symptom twice — it doesn't catch a wrong
interaction method, and it doesn't turn a correlation into a confirmed cause.
The bar for `HIGH`: a third person should be able to manually reproduce it and
confirm the named cause, not just the symptom.

---

## What came from where

| From the May version | From the second version | New here |
|---|---|---|
| HTML + JSON report | Verdict honesty rules | Jira-first intake |
| Gherkin `.feature` output | Fail Recheck Gate (fresh context) | `build-report.mjs` generator + validator |
| Automation gap analysis | Native-interactions-only rule | Public-site reference, secrets stripped |
| Live-DOM regression census | Analytics `TC-AN1` check | Run-folder structure, relative media paths |
| Bug Verification Protocol | Large-scope batching | Consent dismissal by role, vendor-agnostic |
| Video finalization order | Visible-failure rules | Merged recorder with console/network capture |
| Screenshot 6-step sequence | Delta retest phase | `qa-agent test:` explicit comment marker |
| One-compression-attempt rule | Comments-are-mandatory-coverage | Evidence-based `confidence` on every bug |

Conflicts resolved:

- **Compression** — "exactly once" (v1) beats "compress until it fits" (v2). The
  loop was a hang risk. ⚠️ *The threshold number and rationale here didn't
  carry over cleanly in the merge — needs a fix, not guessed at.*
- **Browser control** — v2's native-methods rule wins outright and is promoted to
  an absolute rule. `evaluate()` clicks do not appear in the recording, which
  silently guts the primary deliverable.
- **Report channel** — HTML report is the primary deliverable, attached in full;
  the Jira comment is a text-only summary and notification, not a duplicate of
  the evidence.
- **Pre-existing bugs** — v2's hard line ("if you see it, report it") is kept, but
  paired with v1's reproduce-twice gate so the report is neither green-washed nor
  full of false positives. Both failure modes are called out explicitly in
  `testing-rules.md`.

---

## Demo running order

1. Show the Jira ticket — point at a scenario that exists **only** in a comment
   (bonus: one tagged with the `qa-agent test:` marker, added live).
2. `qa-agent SCRUM-1` — narrate the phases as they announce.
3. Open `qa-report.html`. Scroll to the comment-scenario table: the agent tested
   something that was never in the ticket description.
4. Play the video. Real cursor movement, real clicks — that is the
   native-interactions rule earning its place.
5. Show the regression inventory table: N widgets discovered on the live page,
   each exercised end-to-end. Nobody wrote that list in advance.
6. Show the automation gap section — the exploratory run has produced a
   prioritised automation backlog and a `.feature` scaffold.
7. Optional closer: run `check: AC-2` for the delta retest.

If the live run is risky on stage, capture a good take beforehand with
`qa-record.mjs` and a steps file, and keep that folder as the backup.

---

## Known limits

- **The live site hard-blocks headless Chromium** (Akamai Bot Manager — a 403,
  not a soft failure). This agent's browser launches all use `channel: 'chrome'`
  with `headless: false` via the suite's shared `support/browser.js` config —
  don't run headless for speed without retesting against the live site first.
  Best-effort, not a guarantee; if it stops working, treat that as the site's
  posture changing, not a bug here.
- Single-page-app navigation can swallow `click()`; the protocol handles it by
  falling back to reading `href` and navigating directly, but a genuinely broken
  SPA route will read as ambiguous.
- The element census groups by nearest titled container, so an unusually flat
  DOM produces one giant bucket. Decompose manually when that happens.
- Analytics detection is heuristic — endpoint patterns plus `dataLayer`. A site
  using a bespoke tracker will read as a false FAIL on `TC-AN1`.
- Third-party embeds (chat, maps) are opened but not driven. They are marked
  skipped by design, not by omission. When one *is* interacted with as part of
  a specific bug investigation, confirm the correct gesture for that widget
  first (e.g. a Google Maps Pegman/street-view control is drag-only, never
  click-activated) — a click "failing" on the wrong gesture isn't a site bug.
