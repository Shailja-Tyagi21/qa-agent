#!/usr/bin/env node
/**
 * doctor.js — checks the element registry against the live site.
 *
 *   npm run doctor            # checks home + dealer locator
 *   npm run doctor -- home    # one page
 *
 * Class names on a live production site are not a contract. Run this once
 * before you rely on the suite, and again whenever something starts failing
 * for no obvious reason — it tells you which registry entries no longer
 * resolve, which is faster than reading a stack trace.
 */

const { chromium } = require('playwright')
const { urlFor, elements, collections, pages } = require('../support/pages')
const { chromeLaunchOpts, stealthContext } = require('../support/browser')

const PAGE_SCOPE = {
  home: ['tire search widget', 'auto productline tab', 'motorcycle productline tab',
    'search by vehicle', 'search by size', 'page heading', 'header',
    'main navigation', 'footer', 'find dealers link'],
  'dealer locator': ['dealer search container', 'dealer search input', 'map',
    'top cities list', 'first top city', 'page heading'],
  'dealer results atlanta': ['dealers list', 'dealer card', 'dealer card title',
    'dealer card address']
}

const COLLECTION_SCOPE = {
  home: ['productline tabs', 'navigation links'],
  'dealer results atlanta': ['dealer cards'],
  'dealer locator': ['top cities']
}

async function dismissConsent (page) {
  const tries = [
    () => page.getByRole('button', { name: /agree and close|accept all|^accept$|i agree/i }).first(),
    () => page.getByRole('button', { name: /continue without accepting|reject all/i }).first(),
    () => page.locator('#didomi-notice-agree-button').first()
  ]
  for (const make of tries) {
    try {
      const b = make()
      await b.waitFor({ state: 'visible', timeout: 3500 })
      await b.click()
      await page.waitForTimeout(600)
      return true
    } catch { /* next */ }
  }
  return false
}

;(async () => {
  const only = process.argv.slice(2).filter(a => !a.startsWith('-'))
  const targets = only.length ? only : Object.keys(PAGE_SCOPE)

  const unknown = targets.filter(t => !pages[t])
  if (unknown.length) {
    console.error(`Unknown page(s): ${unknown.join(', ')}`)
    console.error(`Known: ${Object.keys(pages).join(', ')}`)
    process.exit(1)
  }

  const browser = await chromium.launch(chromeLaunchOpts())
  const context = await stealthContext(browser)
  const page = await context.newPage()

  let failures = 0

  for (const pageName of targets) {
    const url = urlFor(pageName)
    console.log(`\n── ${pageName} — ${url}`)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForTimeout(1200)
      const dismissed = await dismissConsent(page)
      console.log(`   consent: ${dismissed ? 'dismissed' : 'none found'}`)
      await page.waitForTimeout(800)
    } catch (e) {
      console.log(`   ❌ navigation failed: ${e.message.split('\n')[0]}`)
      failures++
      continue
    }

    for (const name of (PAGE_SCOPE[pageName] || [])) {
      if (!elements[name]) { console.log(`   ⚠  ${name} — not in registry`); continue }
      try {
        const count = await elements[name](page).count()
        const visible = count > 0 && await elements[name](page).isVisible().catch(() => false)
        if (visible) console.log(`   ✅ ${name}`)
        else if (count > 0) { console.log(`   ⚠  ${name} — present but not visible`) }
        else { console.log(`   ❌ ${name} — no match`); failures++ }
      } catch (e) {
        console.log(`   ❌ ${name} — ${e.message.split('\n')[0]}`)
        failures++
      }
    }

    for (const name of (COLLECTION_SCOPE[pageName] || [])) {
      if (!collections[name]) { console.log(`   ⚠  ${name} — not in registry`); continue }
      try {
        const n = await collections[name](page).count()
        if (n > 0) console.log(`   ✅ ${name} — ${n} found`)
        else { console.log(`   ❌ ${name} — 0 found`); failures++ }
      } catch (e) {
        console.log(`   ❌ ${name} — ${e.message.split('\n')[0]}`)
        failures++
      }
    }
  }

  await context.close()
  await browser.close()

  console.log(failures
    ? `\n${failures} registry entr${failures === 1 ? 'y' : 'ies'} need attention — fix support/pages.js before trusting the suite.\n`
    : '\nAll checked registry entries resolve.\n')
  process.exit(failures ? 1 : 0)
})()
