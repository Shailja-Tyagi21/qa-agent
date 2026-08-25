/**
 * Public michelinman.com (Michelin USA) paths and the named-element registry.
 *
 * Previously pointed at michelin.in (India) — switched because that site's
 * "top cities" widget didn't resolve on inspection; michelinman.com is
 * confirmed reachable and has the equivalent widget. Same underlying CMS
 * (cxf-multisite), but US-English terminology: "tire" not "tyre" throughout,
 * and dealer-locator results are `/auto/dealer-locator/{city}` — no
 * state/country suffix, unlike the India site's `{city}-{state}-india`.
 *
 * Everything here is publicly reachable. No credentials, no preprod hosts.
 * The element registry is the vocabulary the agent composes Gherkin against —
 * a friendly name maps to a locator factory, so feature files stay in English
 * and selectors live in exactly one place.
 */

const BASE_URL = process.env.QA_BASE_URL || 'https://www.michelinman.com'

const pages = {
  home: '/',
  auto: '/auto',
  'tire selector': '/auto/find-the-perfect-tire',
  'all tires': '/auto/browse-tires/all-tires',
  'tire sizes': '/auto/car-tire-sizes',
  manufacturers: '/auto/manufacturers',
  'dealer locator': '/auto/dealer-locator',
  'dealer results atlanta': '/auto/dealer-locator/atlanta',
  'dealer results chicago': '/auto/dealer-locator/chicago',
  'dealer results dallas': '/auto/dealer-locator/dallas',
  motorcycle: '/motorcycle',
  'motorcycle dealer locator': '/motorcycle/dealer-locator',
  promotions: '/deals-promotions-and-rebates',
  'tips and advice': '/auto/auto-tips-and-advice',
  assistance: '/auto/assistance'
}

/**
 * Named elements. Each entry is (page) => Locator.
 *
 * Role-based first, class fallback second — the Michelin design system uses
 * ds__ / dl__ / ts__ prefixes, but class names on a live production site are
 * not a contract. `npm run doctor` reports which of these actually resolve.
 */
const elements = {
  // ── global ────────────────────────────────────────────────────────────────
  'cookie banner': p => p.locator('#didomi-host, [class*="didomi"], #onetrust-banner-sdk').first(),
  header: p => p.locator('header').first(),
  'main navigation': p => p.locator('header nav').first(),
  // NOT `p.locator('footer').first()` — the tire-selector modal has its own
  // <footer> slot (Cancel/Continue buttons) that sits earlier in the DOM and
  // matches first when closed (0×0, but a real, valid match). Anchor on
  // content only the real site footer has.
  footer: p => p.locator('footer').filter({ hasText: /copyright|site map/i }).first(),
  'page heading': p => p.getByRole('heading', { level: 1 }).first(),
  'find dealers link': p => p.getByRole('link', { name: /find dealers/i }).first(),
  'chat assistant': p => p.locator('[class*="chat"], [id*="chat"]').first(),

  // ── tire search widget (homepage hero) ──────────────────────────────────
  'tire search widget': p => p.locator('.ts__widget, [class*="tire-search"]').first(),
  'auto productline tab': p => p.getByRole('button', { name: /^auto$/i }).first(),
  // Substring match, not exact — doctor found 5 productline tabs total (likely
  // one per nav category: Auto/Motorcycle/Bicycle/Classic/Motorsport), and the
  // exact label wasn't confirmed by direct inspection. Anchored /^motorcycle$/
  // matched nothing; this is deliberately looser until confirmed.
  'motorcycle productline tab': p => p.getByRole('button', { name: /motorcycle/i }).first(),
  'search by vehicle': p => p.getByRole('button', { name: /search by vehicle/i }).first(),
  'search by size': p => p.getByRole('button', { name: /search by size/i }).first(),
  'tire search modal': p => p.getByRole('dialog').first(),
  'modal close button': p => p.getByRole('dialog').getByRole('button').first(),
  'search input': p => p.getByRole('textbox').first(),

  // ── dealer locator ────────────────────────────────────────────────────────
  'dealer search container': p => p.locator('[class*="dealer-search"], [class*="dl__"]').first(),
  // getByRole name matching can't see placeholder text — placeholder is
  // explicitly excluded from the accessible-name computation (W3C accname
  // spec), only aria-label/aria-labelledby/<label> count. This input has no
  // visible label, only a placeholder, so getByPlaceholder is required here.
  'dealer search input': p => p.getByPlaceholder(/city, suburb, town or zip/i).first(),
  'locate me button': p => p.getByRole('button', { name: /locate me/i }).first(),
  map: p => p.locator('.dl__map, [class*="map"]').first(),
  'top cities list': p => p.locator('.dl__top-cities-list').first(),
  'first top city': p => p.locator('.dl__top-cities-list').getByRole('link', { name: /^atlanta$/i }).first(),
  'dealers list': p => p.locator('.dl__dealers-list__container, [class*="dealers-list"]').first(),
  'dealer card': p => p.locator('.dl__card-dealer.result, .dl__card-dealer').first(),
  'dealer card title': p => p.locator('.dl__card-dealer__title, .dl__card-dealer h2, .dl__card-dealer h3').first(),
  'dealer card address': p => p.locator('.dl__card-dealer__address').first(),
  'dealer details page': p => p.locator('.dl__content, [class*="dealer-details"]').first(),

  // ── product listing ───────────────────────────────────────────────────────
  'product cards': p => p.locator('[class*="product-card"], [class*="tire-card"], article').first(),
  breadcrumb: p => p.locator('[class*="breadcrumb"]').first()
}

/** Collections — for counting rather than single-element assertions. */
const collections = {
  'dealer cards': p => p.locator('.dl__card-dealer.result, .dl__card-dealer'),
  'top cities': p => p.locator('.dl__top-cities-list a'),
  'productline tabs': p => p.locator('.ts__widget-productLines-container-items, [class*="productLines"] button'),
  'product cards': p => p.locator('[class*="product-card"], [class*="tire-card"]'),
  'navigation links': p => p.locator('header nav a')
}

function pathFor (name) {
  const slug = pages[name]
  if (!slug) {
    throw new Error(`Unknown page "${name}". Known: ${Object.keys(pages).join(', ')}`)
  }
  return slug
}

function urlFor (name) {
  return new URL(pathFor(name), BASE_URL).toString()
}

function elementFor (page, name) {
  const factory = elements[name]
  if (!factory) {
    throw new Error(`Unknown element "${name}". Known: ${Object.keys(elements).join(', ')}`)
  }
  return factory(page)
}

function collectionFor (page, name) {
  const factory = collections[name]
  if (!factory) {
    throw new Error(`Unknown collection "${name}". Known: ${Object.keys(collections).join(', ')}`)
  }
  return factory(page)
}

module.exports = {
  BASE_URL, pages, elements, collections,
  pathFor, urlFor, elementFor, collectionFor
}
