# Gherkin Output & Automation Gap Analysis

Referenced by SKILL.md Phase 7.

This agent runs inside a real Cucumber suite. That changes the job from
"describe what you did in Gherkin" to "write a feature file that actually runs
against the step definitions already in this repo."

---

## Input: `reports/suite-index.json`

Produced by `npm run index` in Phase 1. Read it before planning and again before
writing the feature file. It contains:

| Key | What it gives you |
|---|---|
| `steps[]` | every defined step — `keyword`, `pattern` (with `{string}` / `{int}` placeholders), `params`, `source` |
| `registry.elements` | valid names for `the "<name>" should be visible` and `I click the "<name>"` |
| `registry.collections` | valid names for `I should see more than N "<name>"` |
| `registry.pages` | valid names for `I am on the "<name>" page` |
| `features[]` | existing feature files, their scenarios, tags and steps |
| `knownGaps[]` | coverage the team has explicitly declared missing |

**The registries are closed sets.** `the "sort panel" should be visible` fails at
runtime if `sort panel` is not in `registry.elements` — the step throws
`Unknown element`. Check the name exists before you use it.

---

## Composing the feature file

Write to `features/generated/{ticketId}.feature`.

For each scenario you executed, work down this ladder and stop at the first rung
that fits:

1. **An existing step matches exactly** → use it, substituting real parameter
   values. This is the goal; most scenarios should land here.
2. **An existing step matches but needs a registry name that does not exist**
   (e.g. `the "filter panel" should be visible`, but `filter panel` is not
   registered) → write the step anyway, mark it, and record the missing
   registry entry in `automationGap.missingRegistry[]`. It is a one-line fix in
   `support/pages.js` and worth naming precisely.
3. **No existing step covers the behaviour** → write the step in plain English
   as it *should* read, mark it, and add it to `automationGap.missingSteps[]`
   with the file it belongs in.

Marking convention:

```gherkin
  @generated @todo
  Scenario: S9 — Sorting by rating reorders dealer results
    Given I am on the "dealer results atlanta" page
    When I click the "sort control"
    # @todo no step: sort control is not in registry.elements (support/pages.js)
    And I select the "Highest rated" sort option
    # @todo no step: belongs in steps/dealer-locator.steps.js
    Then the dealer results should be visible
```

Rules:

- Any scenario containing a `@todo` step gets the `@todo` **tag** so
  `npm run test:generated` skips it. A scenario built entirely from existing
  steps gets `@generated` only — and it will actually run.
- Put the `# @todo` comment on the line *after* the step it refers to, naming
  what is missing and which file it belongs in.
- Never invent a registry name and never edit `support/pages.js` yourself —
  proposing the addition is the deliverable; making it is a human's call.

Verify before you finish:

```bash
npx cucumber-js features/generated/{ticketId}.feature --tags "not @todo" --dry-run
```

Undefined steps here mean you composed from vocabulary that does not exist. Fix
the feature file. Do not fix the suite.

---

## Computing the gap

Diff what you tested against `features[]` and `knownGaps[]` from the index.

```json
"automationGap": {
  "suiteIndexedAt": "2026-08-20T09:14:00Z",
  "existingCoverage": [
    "features/dealer-locator.feature — 4 scenarios: page load, city search, card contents, details navigation"
  ],
  "coveredByExisting": ["S1", "S2", "S5"],
  "missingScenarios": [
    { "scenario": "S9",  "summary": "Sort by rating reorders results",        "priority": "HIGH",   "declaredGap": true },
    { "scenario": "S12", "summary": "Empty state for a city with no dealers",  "priority": "MEDIUM", "declaredGap": true },
    { "scenario": "S14", "summary": "Filter count badge updates on apply",     "priority": "MEDIUM", "declaredGap": true }
  ],
  "missingSteps": [
    { "step": "I select the {string} sort option", "belongsIn": "steps/dealer-locator.steps.js" }
  ],
  "missingRegistry": [
    { "name": "sort control", "kind": "element", "suggestedSelector": "role=button[name=/sort by/i]" }
  ],
  "recommendation": "Sort and filter on the dealer results page are entirely unautomated and are where the MAJOR bug landed — 3 scenarios and 1 step definition would close it."
}
```

Field notes:

- `coveredByExisting` — your scenario IDs that an existing feature already
  covers. Being honest here is the point; a gap report that claims credit for
  covered ground is noise.
- `declaredGap: true` — it appears in `knownGaps[]`, so the team already knew.
  That is not a reason to downgrade priority; it is context. An **undeclared**
  gap is more interesting, because nobody had noticed it.
- `priority` — HIGH when a bug was found in that area or an AC depends on it;
  otherwise judge by user impact. Order the array by priority, not discovery
  order.
- `missingSteps` and `missingRegistry` turn this from a complaint into a work
  item. Name the file. Suggest the selector.

If the suite index is unavailable (guard failed, or the agent is running
standalone), say so in `recommendation` rather than emitting an empty
`existingCoverage` that implies no automation exists.

---

## Feature file template

```gherkin
# Generated by qa-agent — {ticketId} — {testDate}
# Target: {targetUrl}
# Scenarios tagged @todo reference steps that do not exist yet; see
# qa-report.html § Automation gap for the list.

@generated @{ticketId}
Feature: {ticketId} — {featureSummary}

  Background:
    Given I am on the "{pageName}" page

  @generated @sanity
  Scenario: S1 — {title}
    Then the "{registered element}" should be visible
    And there should be no console errors

  @generated @ac-1
  Scenario: S4 — {title}
    When I click the "{registered element}"
    Then the URL should contain "{fragment}"

  @generated @from-comment
  Scenario: S7 — {title}
    When I search for the city "{city}"
    And I select the first autocomplete suggestion
    Then the dealer results should be visible

  @generated @todo @bug-1
  Scenario: S9 — {bug title}
    When I click the "sort control"
    # @todo no step: "sort control" missing from registry.elements (support/pages.js)
    Then the dealer results should be reordered by rating
    # @todo no step: belongs in steps/dealer-locator.steps.js
```

---

## Rules

- Scenario IDs match `qa-report.json` exactly — `S1`, `S2`…
- Tags: `@generated` always; then `@sanity` / `@feature` / `@boundary` /
  `@regression` / `@analytics`; `@ac-{n}` where it covers an AC;
  `@from-comment` for scenarios sourced from the Jira thread; `@bug-{n}` on a
  scenario that failed; `@todo` on anything not yet runnable
- Steps describe what the agent **actually did** — no hypothetical steps, none
  for things that were skipped
- Plain English in step text — no CSS selectors, no locators, no code
- Omit sections with no scenarios; do not leave empty headers
- Never edit an existing feature file, step definition, or `support/pages.js`
