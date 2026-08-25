# michelin-qa

A Playwright + Cucumber suite for the public **michelinman.com** site, with the
`qa-agent` agent installed alongside it.

The point of pairing them: the agent explores the live site, finds bugs, and
then diffs what it tested against what this suite already automates — producing
a real gap report and a runnable `.feature` file, not a suggestion.

---

## Quick start

```bash
npm install
npx playwright install chromium

npm run doctor     # check the selectors still resolve against the live site
npm run index      # build reports/suite-index.json for the agent
npm test           # run the baseline suite
```

`npm run doctor` first, always. This suite points at a live production site;
class names are not a contract. Doctor tells you which registry entries broke
in one screen instead of five stack traces.

---

## Layout

```
michelin-qa/
├─ features/
│  ├─ dealer-locator.feature     baseline — search and results
│  ├─ tire-selector.feature      baseline — widget surface
│  ├─ COVERAGE.md                what is and isn't covered, on purpose
│  └─ generated/                 agent output lands here
├─ steps/
│  ├─ common.steps.js            reusable vocabulary
│  ├─ dealer-locator.steps.js
│  └─ tire-selector.steps.js
├─ support/
│  ├─ pages.js                   slug map + named-element registry
│  └─ world.js                   World, hooks, per-scenario video and trace
├─ scripts/
│  ├─ suite-index.js             → reports/suite-index.json  (the agent's input)
│  └─ doctor.js                  selector health check
└─ .github/skills/qa-agent/      the agent
```

## Scripts

| Command | What it does |
|---|---|
| `npm test` | baseline suite only |
| `npm run test:sanity` / `:dealer` / `:tire` | tag-filtered subsets |
| `npm run test:generated` | agent-produced features, `@todo` excluded |
| `npm run test:all` | everything including `@todo` — expect undefined steps |
| `npm run test:headed` | watch it run |
| `npm run index` | rebuild the suite index |
| `npm run doctor` | verify selectors against the live site |

---

## How the two halves connect

`scripts/suite-index.js` parses the step definitions and feature files into
`reports/suite-index.json`. That file is the agent's answer to two questions it
would otherwise have to guess at:

- **What vocabulary exists?** So generated Gherkin composes from steps that are
  actually implemented, instead of prose nobody can run.
- **What's already covered?** So the gap is a genuine diff, not "no automation
  exists."

The agent reads it in Phase 1 (before planning, so it can weight exploration
toward uncovered areas) and again in Phase 7 (to compose the feature file and
compute the gap).

### The `@todo` convention

Generated scenarios built entirely from existing steps get `@generated` and run.
Anything needing a step that doesn't exist gets `@todo` on the scenario and an
inline comment naming what's missing and which file it belongs in:

```gherkin
    When I click the "sort control"
    # @todo no step: "sort control" missing from registry.elements (support/pages.js)
```

`npm run test:generated` skips `@todo`, so agent output is always runnable.
`features/generated/EXAMPLE-1.feature` ships as a worked example of the shape —
delete it once you have a real one.

### Agent guardrails

Two changes were made to the skill when it moved in here:

1. **Workspace guard** — Phase 1 refuses to run unless `features/`, `steps/` and
   `.github/skills/qa-agent/` are all present. A gap analysis computed against
   the wrong repo looks credible, which makes it worse than none.
2. **Read-only on the suite** — the agent writes to `features/generated/` and
   `qa-runs/`. It proposes additions to `support/pages.js` and the step files in
   its gap report; it never makes them.

---

## The deliberately partial coverage

`features/COVERAGE.md` lists 24 unchecked boxes — filters, sort, empty states,
the whole motorcycle dealer locator, completed tire searches, analytics. Those
gaps are intentional. This suite stands in for a real team's partial automation,
which is the normal state of a real project.

Two things follow:

- Unchecked boxes are passed to the agent as `knownGaps[]`. When it flags one,
  the report marks `declaredGap: true` — the team already knew. An **undeclared**
  gap is the more interesting find, because nobody had noticed it.
- If someone asks whether the gaps were left open on purpose: yes, and say so
  up front. It's a legitimate fixture. It only looks bad if it looks concealed.

---

## Demo running order

1. `npm test` — baseline goes green. Establishes the "before".
2. Show `features/COVERAGE.md` briefly. Don't dwell.
3. Show the Jira ticket — point at a scenario that exists **only** in a comment.
4. `qa-agent SCRUM-1` — narrate the phases.
5. Open `qa-report.html`. Comment-scenario table first: it tested something that
   was never in the description.
6. Play the video. Real cursor, real clicks.
7. Regression inventory: N widgets discovered live, each exercised end-to-end.
   Nobody wrote that list in advance.
8. **Automation gap section** — covered vs missing, with the step definitions and
   registry entries needed to close it.
9. `npm run test:generated` — the agent's feature file runs against your suite.
10. Closer, if a bug was found: show the `@todo` scenario for it. That's the
    backlog item, written by the thing that found the bug.

If a live run is risky on stage, capture a good take beforehand with
`.github/skills/qa-agent/scripts/qa-record.mjs` and keep the folder as backup.

---

## Known limits

- **The site is fronted by Akamai Bot Manager, which hard-blocks headless
  Chromium** — a 403 with body `"The request is blocked."`, not a soft
  hydration issue. Confirmed by testing: headed real Chrome gets a normal 200
  with a full page; headless gets 403 with a 270-byte body. Every browser
  launch in this project (`scripts/doctor.js`, `support/world.js`, the agent's
  `qa-record.mjs`) now defaults to `headless: false` with `channel: 'chrome'`
  and a stripped `navigator.webdriver`, via the shared config in
  `support/browser.js`. **Don't flip this back to headless for CI speed
  without retesting against the live site first** — it will silently start
  failing with empty DOMs again, not an obvious error.
  This is a best-effort bypass, not a guarantee; Akamai fingerprints on more
  than TLS/UA (mouse entropy, request cadence, CDP usage). If it stops working,
  treat that as the site's posture changing, not a bug in this suite.
- **Selectors are otherwise unverified against the live site** beyond what
  `npm run doctor` checks — expect to fix two or three entries in
  `support/pages.js`.
- Retry is set to 1. On a production site with third-party widgets that's
  reasonable; if you find yourself wanting 2, fix the step instead.
- `there should be no console errors` filters known third-party noise (Didomi,
  GTM, Facebook). Widen the allowlist in `steps/common.steps.js` if the site
  adds another vendor — but check it's really theirs first.
- Video is kept only for failing scenarios. Change the `else` branch in
  `support/world.js` `After` if you want all of them.
