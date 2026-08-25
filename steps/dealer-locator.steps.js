/**
 * Dealer locator steps.
 *
 * DELIBERATE SCOPE LIMIT — this file covers search and results only.
 * There are no steps for the filter panel, the sort control, empty states, or
 * the motorcycle dealer locator. That gap is intentional: it is what the
 * qa-agent agent's automation-gap analysis is meant to surface.
 * See features/COVERAGE.md before adding to this file.
 */

const { When, Then } = require('@cucumber/cucumber')
const { expect } = require('@playwright/test')
const { elementFor, collectionFor } = require('../support/pages')

When('I search for the city {string}', async function (city) {
  const input = elementFor(this.page, 'dealer search input')
  await input.waitFor({ state: 'visible', timeout: 15000 })
  await input.click()
  await input.fill(city)
  await this.page.waitForTimeout(1500) // autocomplete debounce
})

When('I select the first autocomplete suggestion', async function () {
  const suggestion = this.page
    .locator('#autocomplete-suggestions li, [class*="autocomplete"] li, [role="option"]')
    .first()
  await suggestion.waitFor({ state: 'visible', timeout: 10000 })
  await suggestion.click()
  await this.page.waitForLoadState('domcontentloaded')
  await this.page.waitForTimeout(1500)
})

When('I click the first top city', async function () {
  const city = elementFor(this.page, 'first top city')
  await city.waitFor({ state: 'visible', timeout: 15000 })
  await city.click()
  await this.page.waitForLoadState('domcontentloaded')
  await this.page.waitForTimeout(1500)
})

Then('the dealer results should be visible', async function () {
  await expect(elementFor(this.page, 'dealers list')).toBeVisible({ timeout: 20000 })
})

Then('every dealer card should have a {string}', async function (part) {
  const partSelectors = {
    title: '.dl__card-dealer__title, h2, h3',
    address: '.dl__card-dealer__address',
    distance: '.dl__card-dealer-distance, [class*="distance"]'
  }
  const selector = partSelectors[part]
  if (!selector) {
    throw new Error(`Unknown dealer card part "${part}". Known: ${Object.keys(partSelectors).join(', ')}`)
  }

  const cards = collectionFor(this.page, 'dealer cards')
  const count = Math.min(await cards.count(), 5) // first five is a fair sample
  expect(count).toBeGreaterThan(0)

  const missing = []
  for (let i = 0; i < count; i++) {
    if (await cards.nth(i).locator(selector).count() === 0) missing.push(i + 1)
  }
  expect(missing, `Cards missing "${part}": ${missing.join(', ')}`).toHaveLength(0)
})

When('I open the first dealer', async function () {
  const cards = collectionFor(this.page, 'dealer cards')
  await cards.first().waitFor({ state: 'visible', timeout: 15000 })
  await cards.first().locator('.dl__card-dealer__title, h2, h3, a').first().click()
  await this.page.waitForLoadState('domcontentloaded')
  await this.page.waitForTimeout(1500)
})

Then('the dealer details page should be visible', async function () {
  await expect(elementFor(this.page, 'dealer details page')).toBeVisible({ timeout: 20000 })
})
