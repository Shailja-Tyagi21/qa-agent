const { chromium } = require('playwright')
const { chromeLaunchOpts, stealthContext } = require('../support/browser')

;(async () => {
  const browser = await chromium.launch(chromeLaunchOpts())
  const context = await stealthContext(browser)
  const page = await context.newPage()

  // ── footer ──────────────────────────────────────────────────────────────
  await page.goto('https://www.michelinman.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  const footerInfo = await page.evaluate(() => {
    const f = document.querySelector('footer')
    if (!f) return { found: false }
    const cs = getComputedStyle(f)
    const box = f.getBoundingClientRect()
    return {
      found: true,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      height: box.height,
      width: box.width,
      className: f.className.slice(0, 200),
      childCount: f.children.length,
      outerHTMLSample: f.outerHTML.slice(0, 300)
    }
  })
  console.log('=== FOOTER (homepage) ===')
  console.log(JSON.stringify(footerInfo, null, 2))

  // scroll to bottom and recheck — covers lazy-mount-on-scroll footers
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(1500)
  const footerAfterScroll = await page.evaluate(() => {
    const f = document.querySelector('footer')
    if (!f) return { found: false }
    const cs = getComputedStyle(f)
    const box = f.getBoundingClientRect()
    return { display: cs.display, visibility: cs.visibility, height: box.height }
  })
  console.log('=== FOOTER after scroll-to-bottom ===')
  console.log(JSON.stringify(footerAfterScroll, null, 2))

  // ── dealer locator — top cities ────────────────────────────────────────
  await page.goto('https://www.michelinman.com/auto/dealer-locator', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2500)

  const cityCandidates = await page.evaluate(() => {
    const results = []
    // 1. anything with "city" or "cities" in class/id/data-testid
    document.querySelectorAll('[class*="city" i], [class*="cities" i], [id*="city" i], [data-testid*="city" i]')
      .forEach(el => results.push({
        via: 'class/id match',
        tag: el.tagName, className: el.className.slice(0, 100),
        text: (el.innerText || '').slice(0, 60)
      }))
    return results.slice(0, 20)
  })
  console.log('=== DEALER LOCATOR — elements matching city/cities ===')
  console.log(JSON.stringify(cityCandidates, null, 2))

  // dump the full text of the search-container area for manual scan
  const searchAreaText = await page.evaluate(() => {
    const container = document.querySelector('[class*="dealer-search"], [class*="dl__"]')
    return container ? container.innerText.slice(0, 500) : '(no dealer-search container found)'
  })
  console.log('=== DEALER LOCATOR — search area text sample ===')
  console.log(searchAreaText)

  await page.screenshot({ path: 'inspect-dealer-locator.png', fullPage: true })
  console.log('screenshot: inspect-dealer-locator.png')

  await browser.close()
})()
