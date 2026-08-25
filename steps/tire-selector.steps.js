/**
 * Tire selector widget steps.
 *
 * DELIBERATE SCOPE LIMIT — widget surface and tab switching only.
 * There are no steps that complete a search (brand → model → year → results),
 * no steps for search-by-size, no invalid-input handling, and nothing for the
 * results page. That gap is intentional — see features/COVERAGE.md.
 */

const { When, Then } = require('@cucumber/cucumber')
const { expect } = require('@playwright/test')
const { elementFor } = require('../support/pages')

When('I open the tire search modal via {string}', async function (modeName) {
  const mode = this.page.getByRole('button', { name: new RegExp(modeName, 'i') }).first()
  await mode.waitFor({ state: 'visible', timeout: 15000 })
  await mode.click()
  await this.page.waitForTimeout(1200)
})

Then('the tire search modal should be open', async function () {
  await expect(elementFor(this.page, 'tire search modal')).toBeVisible({ timeout: 15000 })
})

Then('the tire search modal should be closed', async function () {
  await expect(elementFor(this.page, 'tire search modal')).toBeHidden({ timeout: 10000 })
})

When('I close the tire search modal', async function () {
  await elementFor(this.page, 'modal close button').click()
  await this.page.waitForTimeout(900)
})

Then('the {string} productline tab should be {string}', async function (tabName, state) {
  const tab = this.page.getByRole('button', { name: new RegExp(tabName, 'i') }).first()
  await expect(tab).toBeVisible({ timeout: 15000 })

  // The widget marks the selected tab with an `active` class or aria-selected;
  // accept either so this does not break on a markup refactor.
  const isActive = await tab.evaluate(el =>
    el.className.includes('active') || el.getAttribute('aria-selected') === 'true')

  expect(isActive, `Expected "${tabName}" tab to be ${state}`).toBe(state === 'active')
})

When('I select the {string} productline', async function (tabName) {
  await this.page.getByRole('button', { name: new RegExp(tabName, 'i') }).first().click()
  await this.page.waitForTimeout(1000)
})
