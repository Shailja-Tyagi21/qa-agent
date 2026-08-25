# Site Reference — public michelinman.com (hackathon-safe)

> **This file contains only publicly reachable URLs. No credentials, no staging
> or preprod hostnames, no internal project paths, no client-confidential data.**
> If you later point this agent at an internal environment, put the base URL and
> credentials in `.env` (`QA_BASE_URL`, `QA_BASIC_USER`, `QA_BASIC_PASS`) and
> read them there — never in this file, never in a report, never in a commit.
>
> Previously pointed at michelin.in (India). Switched because that site's
> "top cities" widget on the dealer locator page didn't resolve on inspection —
> michelinman.com (Michelin USA) has the equivalent, confirmed working, and is
> the same underlying CMS. US-English terminology throughout: **tire**, not
> tyre; **motorcycle**, not motorbike.

Base: `https://www.michelinman.com` — public, no authentication, locale `en-us`.

---

## Path map by affected area

Use these when the ticket names an area but supplies no URL.

| Area | Path |
|---|---|
| Home | `/` |
| Auto landing | `/auto` |
| Tire selector tool | `/auto/find-the-perfect-tire` |
| Browse all tires | `/auto/browse-tires/all-tires` |
| Browse by category | `/auto/browse-tires/by-category` |
| Browse by family | `/auto/browse-tires/by-family` |
| Browse by season | `/auto/browse-tires/by-season` |
| Browse by size | `/auto/car-tire-sizes` |
| Manufacturers hub | `/auto/manufacturers` |
| Manufacturer page | `/auto/manufacturers/{brand}` |
| Dealer locator | `/auto/dealer-locator` |
| Dealer results | `/auto/dealer-locator/{city}` — no state/country suffix |
| Motorcycle landing | `/motorcycle` |
| Motorcycle browse | `/motorcycle/browse-tires/all-tires` |
| Motorcycle dealer locator | `/motorcycle/dealer-locator` |
| Bicycle landing | `/bicycle` |
| Bicycle browse | `/bicycle/browse-tires/all-tires` |
| Classic car tires | `/classic` |
| Motorsport tires | `/motorsport` |
| Promotions | `/deals-promotions-and-rebates` |
| Tips & advice hub | `/auto/auto-tips-and-advice` |
| Assistance | `/auto/assistance` |
| Site map | `/auto/assistance/site-map` |

Confirmed dealer-locator top cities (no state suffix, unlike the India site):
`atlanta`, `chicago`, `dallas`, `los-angeles`, `new-york`.

---

## What is on the page (orientation only)

> These are **hints**, not dependencies. Always discover the real selectors from
> the live DOM first — the site is a live production property and markup changes.
> Prefer role-based locators over CSS.

**Homepage** — consent banner on first visit; header mega-nav (Automotive Tires,
Motorcycle Tires, Bicycle Tires, Other Activities, Tips & Advice, Why Michelin);
a tire-selector hero widget with *Search by Vehicle* / *Search by Size* tabs and
an Auto/Motorcycle/Bicycle productline switcher; an EV feature block; a
"for personal use / for business" tab switcher; a Featured News carousel; a
"how can we help" block with a chat launcher ("Mitch") bottom-right; a large
footer link grid.

That hero widget is the canonical multi-tab decomposition case — productline
tabs plus two search-mode tabs, each with its own flow. Treat it as several
inventory entries, not one.

**Dealer locator** — a single "Enter a city, suburb, town or zip code" input
with a "Locate me" geolocation button, plus a flat list of top-city links
(no autocomplete dropdown confirmed — verify on the live DOM before assuming
one exists). Results pages show dealer cards with name, address, distance and
a CTA, plus filter and sort controls.

**Tire browse pages** — filter and sort panels, product cards (image, name,
family, CTA), and pagination or load-more.

**Promotions** — hero banner, promo cards with CTAs, body copy, legal mentions.

---

## Consent

Discover the banner at runtime — see `execution.md` § Phase 3 for the ordered
candidate list. Match on role and a case-insensitive regex rather than exact
button text, since it wasn't confirmed by direct inspection for this locale.

---

## Standing constraints on a public production site

Because this is a live public property and not a test environment:

- **Read-only testing.** Never submit contact forms, never call or text the
  support number, never subscribe to the newsletter, never register tires or
  create accounts.
- **No injection, no fuzzing, no load testing.** Invalid-input boundary tests
  mean typing an implausible tire size or a nonsense zip code — observing
  natural handling. Nothing adversarial.
- **Third-party embeds** (the "Mitch" chat assistant, maps, YouTube, the Tire
  Reward Center, Amazon storefront links) — interact only as far as opening
  them. Do not drive a third-party widget's internals; mark those inventory
  entries `SKIPPED — third-party embed`.
- **Rate-limit yourself.** Keep a real pause between actions. A recorded
  session should look like a person using the site.
- **Outbound domains** (business.michelinman.com, tirerewardcenter.com,
  guide.michelin.com, tablethotels.com, jobs.michelinman.com, tirerack.com,
  and similar third-party retailer links under Classic Car Dealers) — verify
  the link resolves, then go back. Do not test the destination site.

---

## Sanity suites by area

Run the suite matching `affectedArea` before feature testing.

**Home / promotions**
- Page loads, no console errors, hero renders
- Header nav opens and at least one link navigates
- Tire-selector widget: both search-mode tabs work, productline switcher works
- Footer link grid renders
- Promotions page shows at least one promo with a working CTA

**Dealer locator**
- Search page loads with the city/zip input and top-cities list present
- A top-city link navigates to a results page
- Results page shows more than one card, each with name / address / distance / CTA
- Filter and sort panels open and close, if present — confirm on the live DOM

**Tire browse / selector**
- Size dropdowns populate in order (width → aspect → rim), if the selector uses
  that flow — confirm on the live DOM, this wasn't verified by direct inspection
- Submit reaches a results page with more than one product card
- Filter and sort work independently and together
- Product card CTA reaches a detail page with image, name and specs

**Advice / content**
- Article loads, images render, no broken characters
- In-page anchors and related-article links resolve
- Breadcrumb reflects the actual path
