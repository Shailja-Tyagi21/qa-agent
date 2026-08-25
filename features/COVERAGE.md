# Coverage — what this suite does and does not cover

This suite is deliberately partial. It is a stand-in for a real team's existing
automation: enough to be a genuine baseline, with real gaps left open so the
`qa-agent` agent's gap analysis produces an actual diff rather than "no
automation exists".

Unchecked boxes below are read by `scripts/suite-index.js` and passed to the
agent as declared gaps. Check one off when you automate it.

## Covered

### Dealer locator
- [x] Search page loads with input, map and top-cities list
- [x] City search via autocomplete returns results
- [x] Dealer cards carry title and address
- [x] Opening a dealer reaches the details page

### Tire search widget
- [x] Homepage loads with the widget present
- [x] Productline tab switching changes the active tab
- [x] Search-by-vehicle modal opens and closes

## Not covered

### Dealer locator
- [ ] Filter panel — opening, applying, clearing, and the result-count badge
- [ ] Sort control — every option, and whether results actually reorder
- [ ] Empty state — a city with zero dealers
- [ ] Single-result state — layout with exactly one dealer card
- [ ] Map interaction — pins matching visible cards, zoom, marker click
- [ ] URL parameter persistence — copy the URL, reopen, state restored
- [ ] Back-button behaviour after applying filters or sort
- [ ] Motorcycle dealer locator (`/motorcycle/dealer-locator`) — no coverage at all
- [ ] Dealer details page — reviews, gallery, street view, FAQ accordions

### Tire search widget
- [ ] Completing a search by vehicle (brand → model → year → results)
- [ ] Completing a search by tire size (width → ratio → diameter)
- [ ] Invalid input handling and the no-match error message
- [ ] Clearing the search bar and resetting the flow
- [ ] Skip / incomplete-configuration path to results
- [ ] Product listing page — cards, filters, sort, pagination
- [ ] Product details page

### Cross-cutting
- [ ] Analytics — dataLayer pushes and tracking requests on interaction
- [ ] Keyboard navigation and focus visibility
- [ ] Mobile and tablet viewports
- [ ] Broken-image sweep beyond the pages already covered
- [ ] Header mega-nav — dropdowns and destination links
- [ ] Footer accordion
- [ ] Promotions hub and campaign landing pages
- [ ] Tips & advice article pages

## Note for the demo

If asked whether these gaps were left open on purpose: yes. This suite exists to
represent a partially-automated project, which is the normal state of a real
one. The agent is not being handed a rigged board — it is being handed a
realistic one, and it does not know in advance which boxes are unchecked.
