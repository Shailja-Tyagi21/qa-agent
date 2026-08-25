#!/usr/bin/env node
/**
 * qa-record.mjs — records a video + screenshots for a QA session and emits
 * evidence.json for the agent to merge into qa-report.json.
 *
 *   node scripts/qa-record.mjs --ticket SCRUM-1 --url https://www.michelinman.com/auto/dealer-locator \
 *        [--locale en-us] [--out qa-runs] [--label full] [--steps steps.json|smoke] \
 *        [--width 1280] [--height 800] [--headless]
 *
 * Two ways to use it:
 *
 *   1. Deterministic fallback. When the agent's live browser session fails or a
 *      demo needs a guaranteed clean take, drive it from a steps JSON file. Same
 *      flow, same output, every time.
 *   2. Baseline capture. Run the "smoke" preset first to prove the target is
 *      reachable and capture a baseline shot before the agent starts exploring.
 *
 * The agent's own recorded session is still the primary path — this script does
 * not replace it. It exists so a run never ends with zero evidence.
 *
 * Steps JSON is an array of step objects executed in order:
 *   [ { "action": "waitFor",  "selector": ".dl__map" },
 *     { "action": "click",    "role": "button", "name": "Filters" },
 *     { "action": "fill",     "selector": "input[type=search]", "value": "Atlanta" },
 *     { "action": "press",    "key": "Enter" },
 *     { "action": "shot",     "label": "results" },
 *     { "action": "wait",     "ms": 1200 } ]
 *
 * All interaction uses native Playwright methods so it is visible in the video.
 * No credentials are read from argv — put them in .env as QA_BASIC_USER /
 * QA_BASIC_PASS if the target needs basic auth.
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

// ── .env (manual parse — dotenv prints to stdout and corrupts MCP stdio) ──────
try {
  for (const line of readFileSync(resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim(), v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch { /* no .env — fine, public site needs none */ }

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1]?.startsWith('--') ? true : argv[i + 1]);
};
const bool = (name) => argv.includes(`--${name}`);

const ticket = flag('ticket');
const url    = flag('url');
if (!ticket || !url) {
  console.error('Usage: node qa-record.mjs --ticket <ID> --url <URL> [--locale en-us] [--steps smoke|file.json]');
  process.exit(1);
}
const locale  = flag('locale', 'en-us');
const label   = flag('label', 'full');
const outRoot = flag('out', 'qa-runs');
const width   = Number(flag('width', 1280));
const height  = Number(flag('height', 800));
const stepsArg = flag('steps', 'smoke');

const stamp   = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const runDir  = resolve(process.cwd(), outRoot, `${ticket}-${stamp}`);
const imgDir  = join(runDir, 'images');
const vidDir  = join(runDir, 'videos');
[runDir, imgDir, vidDir].forEach(d => mkdirSync(d, { recursive: true }));

const videoName = `${ticket}_${locale}_${label}.webm`;
const videoDest = join(vidDir, videoName);

// ── steps ────────────────────────────────────────────────────────────────────
const PRESETS = {
  // Minimal, safe, works on any page — proves reachability and captures a baseline.
  smoke: [
    { action: 'shot',       label: 'baseline' },
    { action: 'scrollPage' },
    { action: 'shot',       label: 'full-scroll' },
  ],
};

function loadSteps(a) {
  if (PRESETS[a]) return PRESETS[a];
  const p = resolve(process.cwd(), a);
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) { console.error(`Bad steps JSON (${p}): ${e.message}`); process.exit(1); }
  }
  console.error(`Unknown preset "${a}". Available: ${Object.keys(PRESETS).join(', ')} — or a path to a JSON file.`);
  process.exit(1);
}
const steps = loadSteps(stepsArg);

// ── state ────────────────────────────────────────────────────────────────────
const screenshots = [];
const consoleErrors = [];
const networkFailures = [];
const stepLog = [];
let shotIndex = 0;

// ── helpers ──────────────────────────────────────────────────────────────────
function target(page, step) {
  if (step.role) return page.getByRole(step.role, { name: new RegExp(step.name, 'i') }).first();
  if (step.text) return page.getByText(new RegExp(step.text, 'i')).first();
  if (step.selector) return page.locator(step.selector).first();
  throw new Error('step needs one of: role+name, text, selector');
}

async function clearHighlights(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-qa-highlight]').forEach(el => {
      el.style.outline = ''; el.style.boxShadow = '';
      el.removeAttribute('data-qa-highlight');
    });
  }).catch(() => {});
}

async function highlight(page, loc) {
  try {
    const el = await loc.elementHandle({ timeout: 2000 });
    if (!el) return;
    await page.evaluate((node) => {
      node.style.outline = '3px solid red';
      node.style.boxShadow = '0 0 0 4px rgba(255,0,0,.3)';
      node.setAttribute('data-qa-highlight', 'true');
      node.scrollIntoView({ behavior: 'instant', block: 'center' });
    }, el);
    await page.waitForTimeout(400);
  } catch { /* non-fatal */ }
}

async function shot(page, lbl) {
  shotIndex++;
  const name = `ss_${ticket}_${locale}_${String(shotIndex).padStart(2, '0')}_${String(lbl).replace(/\s+/g, '-')}.png`;
  await page.screenshot({ path: join(imgDir, name), fullPage: false });
  const rel = `images/${name}`;
  screenshots.push(rel);
  console.log(`  📸 ${name}`);
  return rel;
}

async function dismissConsent(page) {
  const tries = [
    () => page.getByRole('button', { name: /agree and close|accept all|accept|i agree/i }).first(),
    () => page.getByRole('button', { name: /continue without accepting|reject|decline/i }).first(),
    () => page.locator('#didomi-notice-agree-button').first(),
    () => page.locator('#onetrust-accept-btn-handler').first(),
    () => page.locator('button[id*="didomi"], button[id*="accept" i]').first(),
  ];
  for (const make of tries) {
    try {
      const btn = make();
      await btn.waitFor({ state: 'visible', timeout: 4000 });
      await btn.click();
      await page.waitForTimeout(700);
      console.log('  ✓ consent dismissed');
      return true;
    } catch { /* next */ }
  }
  console.log('  · no consent banner found');
  return false;
}

async function scrollPage(page) {
  await page.evaluate(async () => {
    await new Promise(res => {
      let total = 0;
      const step = () => {
        window.scrollBy(0, window.innerHeight);
        total += window.innerHeight;
        if (total < document.body.scrollHeight) setTimeout(step, 350);
        else { window.scrollTo(0, 0); res(); }
      };
      step();
    });
  }).catch(() => {});
  await page.waitForTimeout(500);
}

async function census(page) {
  return page.evaluate(() => {
    const sel = 'a[href], button, [role="button"], [role="tab"], input, select, textarea,'
      + ' [class*="cta"], [class*="btn"], [class*="tab"], [class*="accordion"],'
      + ' [class*="carousel"], [class*="search"], [class*="widget"], [class*="card"]';
    const seen = new Map();
    Array.from(document.querySelectorAll(sel)).forEach(el => {
      if (!el.offsetParent && el.getClientRects().length === 0) return;
      const block = el.closest('section, [class*="widget"], [class*="block"], [class*="module"], [class*="panel"], form') || document.body;
      const key = block.className || block.tagName;
      if (!seen.has(key)) seen.set(key, {
        container: String(key).slice(0, 80),
        heading: ((block.querySelector('h1,h2,h3,h4') || {}).innerText || '(no heading)').trim().slice(0, 60),
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
  }).catch(() => []);
}

// ── step executor — native methods only ──────────────────────────────────────
async function runStep(page, step) {
  const desc = `${step.action}${step.selector ? ` ${step.selector}` : ''}${step.name ? ` "${step.name}"` : ''}`;
  console.log(`  ▶ ${desc}`);
  const started = Date.now();
  try {
    switch (step.action) {
      case 'goto':
        await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(900);
        break;
      case 'waitFor':
        await target(page, step).waitFor({ state: step.state || 'visible', timeout: step.timeout || 10000 });
        break;
      case 'click': {
        const loc = target(page, step);
        await loc.waitFor({ state: 'visible', timeout: step.timeout || 10000 });
        await clearHighlights(page);
        await highlight(page, loc);
        await loc.click({ timeout: step.timeout || 10000 });
        await page.waitForTimeout(step.wait || 900);
        break;
      }
      case 'fill': {
        const loc = target(page, step);
        await loc.waitFor({ state: 'visible', timeout: step.timeout || 10000 });
        await highlight(page, loc);
        await loc.fill(String(step.value ?? ''));
        await page.waitForTimeout(step.wait || 500);
        break;
      }
      case 'select':
        await target(page, step).selectOption(step.value);
        await page.waitForTimeout(step.wait || 700);
        break;
      case 'hover':
        await target(page, step).hover({ timeout: step.timeout || 8000 });
        await page.waitForTimeout(step.wait || 600);
        break;
      case 'press':
        await page.keyboard.press(step.key || 'Enter');
        await page.waitForTimeout(step.wait || 900);
        break;
      case 'back':
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        break;
      case 'scrollPage':
        await scrollPage(page);
        break;
      case 'wait':
        await page.waitForTimeout(step.ms || 1000);
        break;
      case 'shot':
        await clearHighlights(page);
        await shot(page, step.label || `step-${shotIndex + 1}`);
        break;
      case 'read': {
        const txt = await target(page, step).innerText();
        console.log(`     → "${txt.slice(0, 120)}"`);
        stepLog.push({ step: desc, ok: true, ms: Date.now() - started, read: txt.slice(0, 300) });
        return;
      }
      default:
        throw new Error(`unknown action "${step.action}"`);
    }
    stepLog.push({ step: desc, ok: true, ms: Date.now() - started });
    if (step.shotAfter) { await clearHighlights(page); await shot(page, step.shotAfter); }
  } catch (e) {
    console.warn(`     ⚠ ${e.message.split('\n')[0]}`);
    stepLog.push({ step: desc, ok: false, ms: Date.now() - started, error: e.message.split('\n')[0] });
    try { await shot(page, `error-${step.action}`); } catch { /* ignore */ }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n🎬 Codex QA evidence recorder`);
  console.log(`   ticket : ${ticket}`);
  console.log(`   url    : ${url}`);
  console.log(`   steps  : ${stepsArg} (${steps.length})`);
  console.log(`   out    : ${runDir}\n`);

  const ctxOpts = {
    viewport: { width, height },
    recordVideo: { dir: vidDir, size: { width: 1280, height: 720 } },
    ignoreHTTPSErrors: true,
    locale,
  };
  if (process.env.QA_BASIC_USER) {
    ctxOpts.httpCredentials = {
      username: process.env.QA_BASIC_USER,
      password: process.env.QA_BASIC_PASS || '',
    };
  }

  // Akamai Bot Manager (confirmed fronting Michelin's b2c sites) hard-blocks
  // headless Chromium
  // with a 403 ("The request is blocked") but passes a headed real-Chrome
  // session. --headless opts back in explicitly if you've confirmed it works
  // against whatever target you're pointing this at.
  const headless = bool('headless');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext(ctxOpts);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400)); });
  page.on('response', r => { if (r.status() >= 400) networkFailures.push(`${r.status()} ${r.url().slice(0, 200)}`); });
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${String(e).slice(0, 400)}`));
  page.on('dialog', d => d.dismiss().catch(() => {}));

  // Video reference must be taken while the page is open.
  const videoRef = page.video();

  let fatal = null;
  let pageTitle = null;
  let elementCensus = [];

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);
    pageTitle = await page.title();
    console.log(`  · title: ${pageTitle}`);

    await dismissConsent(page);
    await page.waitForTimeout(400);

    for (const step of steps) await runStep(page, step);

    await clearHighlights(page);
    await shot(page, 'session-end');

    elementCensus = await census(page);
    console.log(`  · census: ${elementCensus.length} interactive blocks found`);

  } catch (e) {
    fatal = e.message;
    console.error(`\n❌ ${e.message}`);
    try { await shot(page, 'fatal-state'); } catch { /* ignore */ }
  } finally {
    // Order matters: ref (above) → close page → resolve path → close context.
    try {
      await page.close();
      const raw = await videoRef.path();
      await context.close();
      await browser.close();
      if (raw && existsSync(raw)) {
        renameSync(raw, videoDest);
        const mb = (statSync(videoDest).size / 1048576).toFixed(2);
        console.log(`\n🎥 ${videoName} (${mb} MB)`);
      } else {
        console.warn('\n⚠ no .webm produced — check recordVideo.dir');
      }
    } catch (e) {
      console.error(`\n❌ finalization: ${e.message}`);
      try { await context.close(); } catch {}
      try { await browser.close(); } catch {}
    }
  }

  const evidence = {
    ticketId: ticket,
    locale,
    label,
    targetUrl: url,
    pageTitle,
    testDate: new Date().toISOString().slice(0, 10),
    viewport: `Desktop ${width}x${height}`,
    videoFull: existsSync(videoDest) ? `videos/${videoName}` : null,
    screenshots,
    consoleErrors,
    networkFailures,
    elementCensus,
    stepLog,
    fatal,
  };
  writeFileSync(join(runDir, `evidence-${label}.json`), JSON.stringify(evidence, null, 2));

  console.log(`\n✅ done — ${screenshots.length} screenshots, ${consoleErrors.length} console errors, ${networkFailures.length} network failures`);
  console.log(`   evidence: ${join(runDir, `evidence-${label}.json`)}`);
  console.log(`   merge it into qa-report.json, then: node scripts/build-report.mjs ${join(runDir, 'qa-report.json')}\n`);

  if (fatal) process.exit(1);
})();
