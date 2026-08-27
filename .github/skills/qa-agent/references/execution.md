# Execution — QA Agent

Detailed procedure for phases 3–6 and the delta path.
Phases 1–2 and 7 are defined in [SKILL.md](../SKILL.md).

## Contents
- [Phase 3 — Recording setup](#phase-3--recording-setup)
- [Phase 4 — Plan](#phase-4--plan)
- [Phase 5 — Execute](#phase-5--execute)
- [Phase 6 — Evidence finalization](#phase-6--evidence-finalization)
- [Phase D — Delta retest](#phase-d--delta-retest)

---

## PHASE 3 — Recording setup

> Playwright does **not** auto-record. You must explicitly create a context with
> `recordVideo`. Use an **absolute path** for `recordVideo.dir` — a relative path
> resolves against the MCP server's own working directory, not yours.

Video is recorded at **1280×720** while the viewport is **1280×800**. This keeps
a 5-minute session comfortably under ~15 MB while staying legible in a demo. Drop
to 854×480 only if you know the session will run long.

```js
async (page) => {
  const VW = 1280, VH = 800;
  const context = await page.context().browser().newContext({
    viewport: { width: VW, height: VH },
    recordVideo: {
      dir: '/ABSOLUTE/PATH/TO/qa-runs/{ticketId}-{stamp}/videos/',
      size: { width: 1280, height: 720 }
    },
    ignoreHTTPSErrors: true,
    locale: 'en-IN'
  });
  const vp = await context.newPage();
  page._recordingContext = context;
  page._recordingPage = vp;

  // Surface console + network problems for the whole session
  page._consoleErrors = [];
  page._networkFailures = [];
  vp.on('console', m => { if (m.type() === 'error') page._consoleErrors.push(m.text()); });
  vp.on('response', r => { if (r.status() >= 400) page._networkFailures.push(`${r.status()} ${r.url()}`); });
  vp.on('dialog', d => d.dismiss().catch(() => {}));

  await vp.goto('{target_url}', { waitUntil: 'domcontentloaded', timeout: 30000 });
  return 'recording started';
}
```

### Dismiss the consent banner — before any screenshot

Discover the banner from the live DOM rather than assuming a vendor. Try, in
order, and stop at the first that works:

```js
async (page) => {
  const vp = page._recordingPage;
  const candidates = [
    () => vp.getByRole('button', { name: /agree and close|accept all|accept|i agree/i }).first(),
    () => vp.getByRole('button', { name: /continue without accepting|reject|decline/i }).first(),
    () => vp.locator('#didomi-notice-agree-button').first(),
    () => vp.locator('#onetrust-accept-btn-handler').first(),
    () => vp.locator('button[id*="didomi"], button[id*="accept" i]').first()
  ];
  for (const make of candidates) {
    try {
      const btn = make();
      await btn.waitFor({ state: 'visible', timeout: 4000 });
      await btn.click();
      await vp.waitForTimeout(600);
      return 'consent dismissed';
    } catch (_) { /* try next */ }
  }
  return 'no consent banner found';
}
```

If the banner is still present after this, treat it as a **blocking observation**
in the report — every subsequent click may be intercepted, and that must be
visible to whoever reads the report.

All later navigation goes through the recording page:

```js
await page._recordingPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
```

---

## PHASE 4 — Plan

### Mindset — SKEPTIC MODE

You are not here to confirm the feature works. You are here to find where it
breaks.

- **Observe before acting** — snapshot the DOM, understand the page, then click
- **Question everything** — is that the right text? is the spacing off? is that
  element actually interactive or just styled to look like it?
- **Test beyond the ticket** — the ticket describes the happy path; your job is
  everything else
- **Follow curiosity** — bugs cluster; if something looks slightly wrong, dig
- **Try to break things** — rapid clicks, junk input, back button, URL edits

### The cycle — EXPLORE → TEST → OBSERVE → ADAPT

Not a checklist, a loop. If S3 turns up something suspicious, add unplanned
scenarios to chase it. A rigid plan that ignores live findings is a bad plan.

### Test type matrix

| Type | Purpose | Minimum |
|---|---|---|
| Sanity | Affected area still fundamentally works | 3 |
| Feature | Each AC — positive **and** negative | 2 per AC, ≥5 total |
| Comment scenario | Each distinct scenario from Jira comments | 1 each, no merging |
| Boundary | The 10-item checklist per interactive widget | as needed |
| Regression | Every entry in the live inventory | 1 each |
| Analytics | `TC-AN1` — dataLayer / analytics hit fires | 1 per run |
| Viewport | Desktop only unless the ticket says otherwise | — |

Minimum-count expansion strategies when the ACs only yield two obvious tests
(hover/focus states, keyboard path, alternate entry path, breakpoint boundary,
transition completion, adjacent-element interaction, state persistence after
navigate-away-and-back) are in
[testing-rules.md](./testing-rules.md#minimum-test-case-count).

### Regression inventory — Step A: exhaustive census

Do **not** eyeball the page and list what you happen to notice. That is how
widgets get missed. Sweep the DOM.

First, scroll top to bottom to trigger lazy content:

```js
async (page) => {
  await page._recordingPage.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const step = () => {
        window.scrollBy(0, window.innerHeight);
        total += window.innerHeight;
        if (total < document.body.scrollHeight) setTimeout(step, 400);
        else { window.scrollTo(0, 0); resolve(); }
      };
      step();
    });
  });
  return 'scrolled';
}
```

Then census every interactive element, grouped by container:

```js
async (page) => {
  return await page._recordingPage.evaluate(() => {
    const sel = 'a[href], button, [role="button"], [role="tab"], input, select, textarea,'
      + ' [onclick], [class*="cta"], [class*="btn"], [class*="tab"], [class*="accordion"],'
      + ' [class*="carousel"], [class*="slider"], [class*="search"], [class*="widget"], [class*="card"]';
    const seen = new Map();
    Array.from(document.querySelectorAll(sel)).forEach(el => {
      if (!el.offsetParent && el.getClientRects().length === 0) return;
      const block = el.closest('section, [class*="widget"], [class*="block"], [class*="module"], [class*="panel"], form') || document.body;
      const key = block.className || block.tagName;
      if (!seen.has(key)) seen.set(key, {
        container: key,
        heading: (block.querySelector('h1,h2,h3,h4') || {}).innerText || '(no heading)',
        actions: 0, samples: []
      });
      const rec = seen.get(key);
      rec.actions++;
      if (rec.samples.length < 6) {
        rec.samples.push((el.innerText || el.getAttribute('aria-label')
          || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 40));
      }
    });
    return Array.from(seen.values());
  });
}
```

### Regression inventory — Step B: decompose, then execute

A composite widget **multiplies** into entries. A tire-finder with three tabs and
a search CTA on each is not one test — it is three:

- click tab 1 → its panel appears → fill it → click its CTA → verify the result
- same for tab 2
- same for tab 3

End-to-end means completing the flow, not touching the surface:

| Element | "Done" is NOT | "Done" IS |
|---|---|---|
| Search box + button | typing text | type **then submit**, observe result or validation |
| Tab group | confirming tabs exist | click **each** tab, verify panel content changes |
| Multi-CTA widget | clicking one CTA | click **each**, verify each destination |
| Card with CTA | reading the card | click through, verify the landing page loads |
| Dropdown / select | seeing it | open, pick an option, verify the effect |
| Accordion / FAQ | counting items | expand one, verify content reveals |
| Form | seeing fields | fill and submit, or trigger validation with bad input |
| Carousel | seeing it | click next/prev, verify slides move |
| Nav menu | counting links | hover to open a dropdown **and** click a link |
| Map widget | seeing it | search / zoom / click a marker, verify response |

If an element genuinely cannot be exercised (needs login, needs data you don't
have, is a third-party embed you can't drive) → `tested:false` with
`result: "SKIPPED — <specific reason>"`. *"I saw it and it looked fine"* is not a
reason and is not a test.

> **Visibility is not a test. Counting is not a test. Interaction with
> verification is the test.**

Build the array with every entry starting `tested:false`:

```json
{ "widget": "<name>", "selector": "<from census>", "action": "<the interaction>", "tested": false, "result": "" }
```

The inventory is complete only when nothing in the census lacks a matching entry.

---

## PHASE 5 — Execute

### Interaction rule (repeat of Absolute Rule 3)

Native Playwright methods only: `vp.click()`, `vp.fill()`, `vp.hover()`,
`vp.selectOption()`, `vp.keyboard.press()`. Prefer role-based locators —
`getByRole('button', { name: /search/i })` — over brittle CSS.

`vp.evaluate(() => el.click())` does not move a real cursor and **does not appear
in the video**. Since the video is a primary deliverable, evaluate-clicks are
banned for interaction. Read-only inspection with `evaluate()` is fine.

For panels and dropdowns: click the **trigger** to open, wait for the panel, then
click the option. Never click a hidden option directly.

### Screenshot — 6-step sequence, no exceptions

1. **Clear** — remove `outline`, `boxShadow` and `data-qa-highlight` from all elements
2. **Highlight** — `outline: 3px solid red`, `box-shadow: 0 0 0 4px rgba(255,0,0,.3)`, set `data-qa-highlight="true"`
3. **Scroll to centre** — after highlighting:
   ```js
   await vp.$eval('[data-qa-highlight]', el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
   await vp.waitForTimeout(500);
   ```
4. **Capture** — into `{runFolder}/images/`
5. **Move** — if the tool wrote it to `.playwright-mcp/…`, move it into `{runFolder}/images/`
6. **Verify** — stat the destination path; a missing file is a pre-flight blocker

Naming:

| Pattern | Use |
|---|---|
| `ss_{ticketId}_{locale}_S{n}_{slug}.png` | scenario shots — number matches the scenario |
| `ss_{ticketId}_{locale}_bug{n}_{slug}.png` | bug shots — **never** reused from a scenario |

### Bug Verification Protocol

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
5. **Dedicated bug screenshot** — separate from the scenario shot
6. **Confidence** — HIGH (reproduced 2×) / MEDIUM (reproduced, environment-specific) / LOW (once only → observation, not a bug)

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

### Deep checks on every page visited

1. **Spelling & copy** — typos, truncation, broken characters; on a non-English locale, English text is a MAJOR bug
2. **Layout** — nothing overlapping or clipped; every image and icon loads
3. **Adjacent elements** — the widgets next to the feature, not just the feature
4. **Functional accuracy** — is the data ordering/grouping actually correct, not just rendered
5. **Network** — API params match the UI selections
6. **Console** — zero tolerance for new JS errors

### TC-AN1 — analytics check (once per run, mandatory)

Before the first CTA click or navigation, start listening for requests to
analytics endpoints (GA, GTM, Tealium, Segment) and snapshot `window.dataLayer`.
Perform the action, then compare.

- ✅ PASS — at least one analytics request or `dataLayer` push captured
- 🔴 FAIL (MAJOR) — zero analytics signal after an interaction

### STOP conditions

| Situation | Action |
|---|---|
| Every page 500/404 | stop, write the report, verdict BLOCKED |
| BLOCKER found in sanity | note it, **continue** all remaining tests |
| Same crash on 3+ cases | note as a systemic issue, continue |
| Consent banner undismissable | note as blocking observation, continue and flag reliability |

Never end a run with nothing written. Partial results are still results.

---

## PHASE 6 — Evidence finalization

### Order matters

```js
async (page) => {
  const vp  = page._recordingPage;
  const ctx = page._recordingContext;
  const video = await vp.video();        // 1. reference BEFORE close
  await vp.close();                      // 2. close page — flushes the .webm
  const videoPath = await video.path();  // 3. resolve AFTER page close
  await ctx.close();                     // 4. close context
  return videoPath;
}
```

Get it wrong and you end up with no video path, or a zero-byte file.

### Rename immediately

Playwright writes UUID filenames.

```bash
mv "{videoPath}" "{runFolder}/videos/{ticketId}_{locale}_full.webm"
```

Set `videoFull` in `qa-report.json` to the path **relative to the run folder**
(`videos/{ticketId}_{locale}_full.webm`) so the HTML embed works when the folder
is zipped and shared.

### Size handling — one compression attempt

```bash
ls -lh "{runFolder}/videos/{ticketId}_{locale}_full.webm"
which ffmpeg
```

| Size | ffmpeg | Action |
|---|---|---|
| ≤ 20 MB | — | keep as-is |
| > 20 MB | no | keep the webm, note the size in the report |
| > 20 MB | yes | one ffmpeg pass → if smaller, use it; if not, delete it and keep the original |

```bash
ffmpeg -i "{in}.webm" -vf "scale=854:-2" -b:v 500k -an "{out}.mp4" -y
```

Producing an `.mp4` alongside the `.webm` is worth doing anyway — some players
and email clients will not play webm, and the report embeds both as sources.

> **Compression is attempted exactly once.** Never retry with different bitrates.
> If it does not help, move on.

### Optional focused clip

If the full session is unwieldy for a demo, record a second short context
covering only the core flow, save as `{ticketId}_{locale}_clip.webm`, and set
`videoClip` in the JSON. The report shows the clip first and the full session
below it.

---

## PHASE D — Delta retest

Triggered by `check: <scope>` — an AC number, a bug ID, or a named area.

1. **Scope** — read the previous run's `qa-report.json`; identify exactly which
   cases cover the scope; confirm `{target_url}` still resolves
2. **Fresh everything** — new run folder, new recording context, no reused state
3. **Execute** — only the scoped cases; baseline screenshot, applied-state
   screenshot, plus any new bug evidence; console checked throughout
4. **Verdict**

   | Result | Delta verdict |
   |---|---|
   | Scoped items now pass | ✅ Fixed |
   | Scoped items still fail | 🔴 Not fixed |
   | Something adjacent broke | 🔴 Regression introduced |

5. **Report** — same JSON → `build-report.mjs` → HTML pipeline, with
   `"runType": "delta"` and `"deltaScope": "<scope>"` set in the JSON
6. **Post** — Jira comment with the delta table and the verdict; update labels
   only if all scoped items pass and no regression appeared
