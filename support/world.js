/**
 * Cucumber World + lifecycle hooks.
 *
 * One browser per run, one context per scenario. Video is recorded per
 * scenario and kept only when the scenario fails — that keeps the artefacts
 * folder small while guaranteeing evidence for anything red.
 */

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const {
  setWorldConstructor, setDefaultTimeout,
  BeforeAll, AfterAll, Before, After, Status
} = require('@cucumber/cucumber')
const { chromeLaunchOpts, CONTEXT_DEFAULTS } = require('./browser')

setDefaultTimeout(60 * 1000)

const ARTIFACTS = path.resolve(process.cwd(), 'reports', 'artifacts')
const VIEWPORT = { width: 1280, height: 800 }

let browser

class QAWorld {
  constructor ({ attach, parameters }) {
    this.attach = attach
    this.parameters = parameters
    this.consoleErrors = []
    this.networkFailures = []
    this.newPagePromise = null
  }

  /** Dismiss the consent banner. Vendor-agnostic, role first. */
  async dismissConsent () {
    const tries = [
      () => this.page.getByRole('button', { name: /agree and close|accept all|^accept$|i agree/i }).first(),
      () => this.page.getByRole('button', { name: /continue without accepting|reject all|decline/i }).first(),
      () => this.page.locator('#didomi-notice-agree-button').first(),
      () => this.page.locator('#onetrust-accept-btn-handler').first()
    ]
    for (const make of tries) {
      try {
        const btn = make()
        await btn.waitFor({ state: 'visible', timeout: 3500 })
        await btn.click()
        await this.page.waitForTimeout(600)
        return true
      } catch { /* next candidate */ }
    }
    return false
  }

  async goto (url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await this.page.waitForTimeout(800)
    await this.dismissConsent()
  }

  async shot (label) {
    const buf = await this.page.screenshot({ fullPage: false })
    this.attach(buf, 'image/png')
    if (label) {
      const file = path.join(ARTIFACTS, `${this.slug}_${label.replace(/\W+/g, '-')}.png`)
      fs.writeFileSync(file, buf)
    }
  }
}

setWorldConstructor(QAWorld)

BeforeAll(async function () {
  fs.mkdirSync(ARTIFACTS, { recursive: true })
  browser = await chromium.launch(chromeLaunchOpts())
})

AfterAll(async function () {
  if (browser) await browser.close()
})

Before(async function (scenario) {
  this.slug = scenario.pickle.name.replace(/\W+/g, '-').slice(0, 60).toLowerCase()

  this.context = await browser.newContext({
    ...CONTEXT_DEFAULTS,
    viewport: VIEWPORT,
    recordVideo: { dir: ARTIFACTS, size: { width: 1280, height: 720 } },
    ignoreHTTPSErrors: true
  })
  await this.context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
  await this.context.tracing.start({ screenshots: true, snapshots: true })

  this.page = await this.context.newPage()
  this.page.on('console', m => {
    if (m.type() === 'error') this.consoleErrors.push(m.text().slice(0, 400))
  })
  this.page.on('pageerror', e => this.consoleErrors.push(`pageerror: ${String(e).slice(0, 400)}`))
  this.page.on('response', r => {
    if (r.status() >= 400) this.networkFailures.push(`${r.status()} ${r.url().slice(0, 200)}`)
  })
  this.page.on('dialog', d => d.dismiss().catch(() => {}))
})

After(async function (scenario) {
  const failed = scenario.result?.status === Status.FAILED

  if (failed) {
    try { await this.shot('failure') } catch { /* page may be closed */ }
    try {
      await this.context.tracing.stop({ path: path.join(ARTIFACTS, `${this.slug}_trace.zip`) })
    } catch { /* ignore */ }
    if (this.consoleErrors.length) {
      this.attach(`Console errors:\n${this.consoleErrors.join('\n')}`, 'text/plain')
    }
    if (this.networkFailures.length) {
      this.attach(`Network failures:\n${this.networkFailures.join('\n')}`, 'text/plain')
    }
  } else {
    try { await this.context.tracing.stop() } catch { /* ignore */ }
  }

  // Video reference must be taken before the page closes; path resolves after.
  let video = null
  try { video = this.page.video() } catch { /* no video */ }

  try { await this.page.close() } catch { /* ignore */ }
  let videoPath = null
  try { videoPath = video ? await video.path() : null } catch { /* ignore */ }
  try { await this.context.close() } catch { /* ignore */ }

  if (videoPath && fs.existsSync(videoPath)) {
    if (failed) {
      const dest = path.join(ARTIFACTS, `${this.slug}.webm`)
      fs.renameSync(videoPath, dest)
      this.attach(`Video: ${path.relative(process.cwd(), dest)}`, 'text/plain')
    } else {
      fs.unlinkSync(videoPath)
    }
  }
})
