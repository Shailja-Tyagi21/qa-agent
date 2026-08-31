# Testing Rules — verdicts, severity, boundaries, always/never

## Contents
- [Verdict honesty](#verdict-honesty--non-negotiable)
- [Bug severity](#bug-severity)
- [Bug Verification Protocol](#bug-verification-protocol)
- [Minimum test case count](#minimum-test-case-count)
- [Boundary checklist](#mandatory-boundary-checklist)
- [Viewport rules](#viewport-rules)
- [Large-scope execution](#large-scope-execution)
- [Visible-failure rules](#visible-failure-rules)
- [Known defects](#known-defect-handling)
- [ALWAYS](#always) / [NEVER](#never)

---

## Verdict honesty — NON-NEGOTIABLE

These override everything else. **The verdict reflects the worst bug found.**

### Do not soften results

- A FAIL is a FAIL. Never downgrade it to PARTIAL because it "mostly works".
- PARTIAL is only for cosmetic MINOR defects that do not affect core behaviour.
- A failing boundary test is a FAIL — reset not clearing, URL param not
  restoring, invalid input crashing are all FAILs, not edge cases to wave off.
- Never mark PASS on a case you did not actually execute in the browser.

### But do not manufacture failures either

Honesty runs both directions. The Fail Recheck Gate exists because a green-washed
report and a false-positive-riddled report are both useless. Specifically:

- No negative verdict from a single unverified run
- If the UI state and data ordering prove the AC behaviour works, a URL param
  that does not mutate is an **observation**, not a FAIL — unless the AC
  explicitly requires URL mutation
- If a failure does not reproduce in the recheck, mark the original as a false
  negative, say so in the observations, and continue

### Pre-existing issues

You do not have baseline-comparison authority. If you observe it during your
session, it goes in the report — a 404 is a FAIL, a console error is a bug,
regardless of whether someone thinks it was already there. What you *can* do is
note *"may be pre-existing — needs developer confirmation"* alongside it. What
you cannot do is silently drop it.

The one carve-out: known defects already tagged `CDL-xxx` (see below).

---

## Bug severity

| Severity | Definition |
|---|---|
| **BLOCKER** | Feature completely broken; nothing works; release must be blocked |
| **CRITICAL** | Core AC not met; no workaround |
| **MAJOR** | AC partially met; workaround may exist; **includes every i18n / localisation gap** |
| **MINOR** | Cosmetic, low impact; can ship as a documented known issue |

> Missing localisation is **always MAJOR**. An English label on a non-English
> locale page is not a nitpick.

| Worst finding | Verdict | Label |
|---|---|---|
| Zero bugs | APPROVED | `qa::passed` |
| MINOR only | APPROVED with notes | `qa::conditional` |
| Any MAJOR | CONDITIONAL APPROVAL | `qa::conditional` |
| Any BLOCKER or CRITICAL | REJECTED | `qa::failed` |
| Environment down | BLOCKED | `qa::blocked` |

---

## Bug Verification Protocol

**No bug is reported on a single observation.** Playwright produces false signals
— slow-loading elements, SPA routers swallowing clicks, your own injected
highlights breaking layout, transient network blips.

1. **First observation** — note internally, do not report
2. **Clear your artefacts** — remove highlights, scroll away and back
3. **Reproduce** — refresh and repeat the exact action
   - disappears → transient artefact, log as an observation only
   - persists → continue
4. **Fail Recheck Gate** — before any FAIL verdict or any bug rated MAJOR+:
   reproduce it in a **new browser context and new page**, same URL and locale,
   capturing a pre-action baseline screenshot and a post-action failing-state
   screenshot, plus one deterministic signal tied to the AC (role-based locator
   presence/absence, control label change, result ordering change, or a network
   param mismatch). If run and recheck disagree, run one tie-break.
5. **Before naming a cause, prove it — correlation is not causation.** Two
   identical reproductions can still share one wrong method, so the Fail
   Recheck Gate alone does not license naming *why* something fails. If a
   diagnostic signal (`elementFromPoint`, a computed style, a z-index) points
   at a suspected blocker, don't write "X is blocking Y" from that signal
   alone: disable X (`pointer-events: none` via `evaluate`, read-only per the
   native-interactions rule, or hide it) and retry the interaction on Y. If Y
   now works, causation is confirmed — name it. If Y still fails, X was not
   the reason — report what actually is, not the first guess. This step does
   not apply when the failure is already self-evidently mechanical (a thrown
   console error, a literal wrong count, a DOM attribute value like
   `tabindex="-1"`) — those need no causal inference at all.
6. **Confirm the right interaction verb before reporting a click failure on a
   third-party embedded widget** (maps, calendars, chat, payment embeds). Many
   have their own established gesture — e.g. a Google Maps Pegman/street-view
   control is drag-only, never click-activated. A native click "failing"
   there may mean nothing more than the wrong gesture was used, not a bug in
   the host page.
7. **Dedicated bug screenshot** — separate from the scenario shot
8. **Confidence** — reflects both how many times it reproduced and how the
   cause was established, not reproduction count alone:
   - **HIGH** — reproduced 2× (the Fail Recheck Gate), **and** either the
     failure is self-evidently mechanical or a claimed cause passed step 5's
     isolating test. A `HIGH` bug should survive someone else manually
     reproducing it and checking the named cause.
   - **MEDIUM** — reproduced 2×, but a claimed cause is inferred from
     correlation only (step 5 not run, or inconclusive) — say so explicitly
     in `actual` rather than presenting the guess as settled fact. Also use
     `MEDIUM` for a reproduced but environment-specific failure.
   - **LOW** — reproduced once only → this is an observation, not a bug.

Type-specific extra checks:

| Bug type | Extra step |
|---|---|
| CTA/link not navigating | read `href`, try `goto(href)` directly; if the destination loads it is an SPA/tooling limitation, not a product bug. Wait up to 5s for SPA routing. |
| Element missing | wait 2s, re-snapshot, check whether it needs scrolling |
| Wrong text / typo | extract via `$eval(sel, el => el.textContent)` — never judge from a screenshot alone |
| Layout break | remove injected highlights first; if it disappears, you caused it |
| Console error | check whether it fires on a clean load with no test actions |
| Network 4xx/5xx | is it analytics/third-party? report first-party failures that break visible behaviour |

**Mixed-signal rule:** if the UI state changes correctly (selected label updates,
results reorder) do **not** fail the feature purely because a URL param did not
mutate — record the URL behaviour as an observation, unless the AC explicitly
requires URL mutation.

**Never silently skip.** Cannot reproduce after two attempts? Record it as a LOW
confidence observation: *"observed once, not reproducible on retry — flagged for
human review."* Every anomaly is recorded somewhere.

---

## Minimum test case count

Every run produces **at least 5 feature test cases**, regardless of ticket size.
If the ACs only yield two or three obvious tests, expand:

| Strategy | Example on a CSS-only change |
|---|---|
| Hover / focus states | verify `:hover` and `:focus-visible` styling |
| Keyboard path | tab to it, press Enter/Escape — correct behaviour? |
| Alternate entry path | reach the same component via different navigation |
| Breakpoint boundary | test at 767px vs 768px — does the style actually switch? |
| Transition completion | no flicker, no stuck state mid-animation |
| Adjacent element | nearby elements unaffected visually and functionally |
| State persistence | trigger it, navigate away, come back — does state hold? |

Never assume "small change = few tests".

---

## Mandatory boundary checklist

Apply to **every** interactive feature — filter, sort, search, form, dropdown:

| # | Condition | What to verify |
|---|---|---|
| 1 | Empty state | 0 results / nothing selected renders gracefully |
| 2 | Single item | 1 result does not break layout |
| 3 | Maximum input | very long text, maximum allowed values |
| 4 | Minimum input | 1 character, minimum allowed values |
| 5 | Invalid input | wrong format, unexpected characters — observe natural handling only, **never attempt injection** |
| 6 | Rapid interaction | click/filter repeatedly and fast — no stack, no crash |
| 7 | Combined state | multiple filters/sorts at once behave correctly |
| 8 | Reset / clear | restores the *exact* original state |
| 9 | URL persistence | copy URL → fresh tab → state restored |
| 10 | Back button | back after applying state restores gracefully |

---

## Viewport rules

**Default: desktop 1280×800 only.**

Add mobile or tablet only when the ticket explicitly signals it — keywords
`mobile`, `responsive`, `tablet`, `breakpoint`, `viewport`, a pixel width, `iPad`,
`iPhone`, `small screen`, or an instruction like "check on 375px".

| Viewport | Size |
|---|---|
| Desktop | 1280 × 800 |
| Mobile | 360 × 640 |
| Tablet | 768 × 1024 |

If triggered: use exactly the size named, re-run all feature cases at that size,
tag every result row with the viewport, and additionally check for overflow,
clipped controls, and mobile patterns (drawers, hamburger menus).

If not triggered: do not add mobile/tablet rows to the report at all.

---

## Large-scope execution

Scope is **large** if either is true:

- The ticket or its comments split into multiple `Feature:` blocks
- The scenario inventory exceeds 12 entries

Then:

- Never run it as one unbatched pass
- One batch per `Feature:` block; if no natural blocks, groups of ≤6 scenarios
- A `Feature:` block with more than 6 scenarios splits into sub-batches of ≤6
- If subagents are available, one invocation per batch — never loop batches
  inside a single call
- Announce the batch plan before starting
- Post **one** consolidated final verdict, with totals reconciled across all
  batches, not just the last one
- On resume, state explicitly which batches completed and which are pending

---

## Visible-failure rules

- Never fail or stop silently
- If a batch, phase or whole run cannot complete, record before stopping: what
  failed, why (timeout, tool error, budget, environment), current progress, and
  what remains
- Never leave a run with only an "in progress" note and no outcome
- A partial report with an honest gap list beats no report

---

## Known defect handling

Defects already tagged `CDL-xxx` in feature-file comments or the ticket:

- **Do not** re-report them as new bugs
- **Do** observe and verify their current state during the run:
  - appears fixed → `"CDL-xxx appears resolved — <what you observed>"`
  - still present → `"CDL-xxx still reproducible — <current behaviour>"`
  - changed → note the change
- These go into `observations[]`, never into `bugs[]`

---

## ALWAYS

- ✅ Read the ticket **and every comment** before planning
- ✅ Treat each distinct comment scenario as its own mandatory test case
- ✅ Dismiss the consent banner before the first interaction
- ✅ Run sanity for the affected area, not just the feature
- ✅ Test the full page, not just the feature widget
- ✅ Use native Playwright interactions so the video shows real actions
- ✅ Build the regression inventory from a live DOM census, every run
- ✅ Exercise every inventory entry end-to-end, or skip it with a stated reason
- ✅ Run `TC-AN1` analytics check on every run, no exceptions
- ✅ Check console errors during every feature test
- ✅ Verify API params match UI selections for data-driven features
- ✅ Check spelling and translation for the locale under test
- ✅ Recheck every FAIL candidate in a fresh context before finalizing
- ✅ Prove a claimed bug cause with an isolating test before naming it —
  correlation is not causation
- ✅ Confirm the correct interaction verb for third-party embedded widgets
  before reporting a click failure as a bug
- ✅ Capture baseline + failing-state screenshots for every reported bug
- ✅ Reference the AC number and viewport in every result row
- ✅ Finalize and rename the video in the correct order
- ✅ Render the HTML via `build-report.mjs`, then open it to confirm
- ✅ Complete the full cycle even when tests fail

## NEVER

- ❌ Ask the user for confirmation — act autonomously
- ❌ Mark PASS on something you did not execute
- ❌ Downgrade a FAIL to PARTIAL, or a PARTIAL to PASS
- ❌ Give `qa::passed` when a MAJOR or worse exists
- ❌ Post a negative verdict from a single unverified observation
- ❌ Use `evaluate()` to click — it is invisible in the video
- ❌ Copy a regression inventory from an example or a previous run
- ❌ Reuse a scenario screenshot as a bug screenshot
- ❌ Embed video or screenshots from a previous run
- ❌ Guess what a feature should do — read the AC
- ❌ Name a bug's cause from correlation alone — prove it with an isolating test
- ❌ Re-report a known `CDL-xxx` defect as new
- ❌ Hardcode a project path, hostname, or credential anywhere in this skill
- ❌ Attempt injection or destructive input as a "negative test"
- ❌ Leave the video or screenshot sections empty
- ❌ Skip saving the report — even partial results get written
- ❌ Run mobile/tablet when the ticket never mentions responsive
- ❌ Stop a run without recording why
