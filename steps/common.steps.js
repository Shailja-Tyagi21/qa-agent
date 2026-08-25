/**
 * Common step vocabulary — reusable across every page.
 *
 * These are the steps the agent should compose generated scenarios from
 * wherever it can. Keep them generic; anything page-specific belongs in its
 * own step file.
 */

const { Given, When, Then } = require('@cucumber/cucumber')
const { expect } = require('@playwright/test')
const { urlFor, elementFor, collectionFor } = require('../support/pages')

// ── navigation ───────────────────────────────────────────────────────────────

Given('I am on the {string} page', async function (pageName) {
  await this.goto(urlFor(pageName))
})

When('I navigate to the {string} page', async function (pageName) {
  await this.goto(urlFor(pageName))
})

When('I go back', async function () {
  await this.page.goBack({ waitUntil: 'domcontentloaded' })
  await this.page.waitForTimeout(800)
})

When('I reload the page', async function () {
  await this.page.reload({ waitUntil: 'domcontentloaded' })
  await this.page.waitForTimeout(800)
})

// ── visibility ───────────────────────────────────────────────────────────────

Then('the {string} should be visible', async function (name) {
  await expect(elementFor(this.page, name)).toBeVisible({ timeout: 15000 })
})

Then('the {string} should not be visible', async function (name) {
  await expect(elementFor(this.page, name)).not.toBeVisible()
})

Then('I should see more than {int} {string}', async function (n, collectionName) {
  const items = collectionFor(this.page, collectionName)
  await expect(items.first()).toBeVisible({ timeout: 15000 })
  expect(await items.count()).toBeGreaterThan(n)
})

Then('I should see at least {int} {string}', async function (n, collectionName) {
  const items = collectionFor(this.page, collectionName)
  expect(await items.count()).toBeGreaterThanOrEqual(n)
})

// ── interaction ──────────────────────────────────────────────────────────────

When('I click the {string}', async function (name) {
  const el = elementFor(this.page, name)
  await el.waitFor({ state: 'visible', timeout: 15000 })
  await el.click()
  await this.page.waitForTimeout(900)
})

When('I click the {string} link', async function (linkName) {
  await this.page.getByRole('link', { name: new RegExp(linkName, 'i') }).first().click()
  await this.page.waitForTimeout(1200)
})

When('I click the {string} button', async function (buttonName) {
  await this.page.getByRole('button', { name: new RegExp(buttonName, 'i') }).first().click()
  await this.page.waitForTimeout(900)
})

When('I type {string} into the {string}', async function (text, name) {
  const el = elementFor(this.page, name)
  await el.waitFor({ state: 'visible', timeout: 15000 })
  await el.fill(text)
  await this.page.waitForTimeout(600)
})

When('I press {string}', async function (key) {
  await this.page.keyboard.press(key)
  await this.page.waitForTimeout(1200)
})

When('I scroll through the whole page', async function () {
  await this.page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0
      const step = () => {
        window.scrollBy(0, window.innerHeight)
        total += window.innerHeight
        if (total < document.body.scrollHeight) setTimeout(step, 350)
        else { window.scrollTo(0, 0); resolve() }
      }
      step()
    })
  })
  await this.page.waitForTimeout(500)
})

// ── assertions on page state ─────────────────────────────────────────────────

Then('the page heading should contain {string}', async function (text) {
  await expect(this.page.getByRole('heading', { level: 1 }).first())
    .toContainText(new RegExp(text, 'i'))
})

Then('the page title should contain {string}', async function (text) {
  expect(await this.page.title()).toMatch(new RegExp(text, 'i'))
})

Then('the URL should contain {string}', async function (fragment) {
  await expect(this.page).toHaveURL(new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
})

Then('there should be no console errors', async function () {
  // Third-party analytics and consent scripts are noisy on production; only
  // first-party script failures are treated as a defect here.
  const relevant = this.consoleErrors.filter(e =>
    !/didomi|onetrust|googletag|gtm|facebook|doubleclick|hotjar/i.test(e))
  expect(relevant, `Console errors:\n${relevant.join('\n')}`).toHaveLength(0)
})

Then('every image on the page should have loaded', async function () {
  const broken = await this.page.evaluate(() =>
    Array.from(document.images)
      .filter(img => img.complete && img.naturalWidth === 0)
      .map(img => img.currentSrc || img.src)
      .slice(0, 10))
  expect(broken, `Broken images:\n${broken.join('\n')}`).toHaveLength(0)
})

Then('the page should open in a new tab', async function () {
  const newTab = await this.newPagePromise
  await newTab.waitForLoadState('domcontentloaded', { timeout: 30000 })
  this.newTab = newTab
  expect(newTab.url()).toBeTruthy()
})

When('I close the new tab', async function () {
  await this.newTab.close()
  this.newTab = null
})

// ── screenshot helper for readable reports ───────────────────────────────────

When('I capture a screenshot named {string}', async function (label) {
  await this.shot(label)
})
