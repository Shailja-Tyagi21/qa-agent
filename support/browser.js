/**
 * Shared browser-launch config — works around Akamai Bot Manager on
 * michelin.in, which hard-blocks headless Chromium with a 403
 * ("The request is blocked") but passes a headed real-Chrome session.
 *
 * This is a best-effort bypass, not a guarantee. Akamai fingerprints on more
 * than one signal (TLS/JA3, CDP usage, mouse entropy, request cadence) and
 * could tighten further. If this stops working, that's what changed — the
 * fix then is a deeper stealth setup or a different approach entirely, not
 * more retries or longer waits.
 *
 * Two things matter here, both required, neither sufficient alone:
 *   1. headless: false, channel: 'chrome' — a real Chrome binary, not the
 *      bundled Chromium, and not running headless. This is what separated
 *      the 200 from the 403 in testing.
 *   2. Stripping navigator.webdriver — Playwright sets this by default;
 *      Chromium's own devtools protocol usage otherwise reveals automation.
 */

function chromeLaunchOpts (overrides = {}) {
  return {
    channel: 'chrome',
    headless: !!process.env.HEADLESS, // opt-in only — see note above
    args: ['--disable-blink-features=AutomationControlled'],
    ...overrides
  }
}

const CONTEXT_DEFAULTS = {
  viewport: { width: 1280, height: 800 },
  locale: 'en-IN',
  timezoneId: 'Asia/Kolkata'
}

async function stealthContext (browser, overrides = {}) {
  const context = await browser.newContext({ ...CONTEXT_DEFAULTS, ...overrides })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
  return context
}

module.exports = { chromeLaunchOpts, CONTEXT_DEFAULTS, stealthContext }
