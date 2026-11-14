# 2026-11-14 — Visual direction: system, Home and player page

A direction checkpoint for Jamie, held as a draft before the other
surfaces are restyled. This follows `VISION.md` and the Home and Timeline
briefs: people and their play lead, and the interface stays out of the way.
No MCP, JSON API or database version changes.

## Proposed system

- Neutral dark grounds, violet for actions and selection, and a gold
  wordmark. Inter leads content, names and page titles; numeric runs use
  tabular digits. The game's face remains on wordmarks.
- Six core text sizes: 12, 14, 16, 20, 24 and 32px. The remaining type
  tokens cover card-art labels, the battle score, a relative tag and the
  responsive site title. Existing Tailwind utility names remain aliases.
- One 8px radius, plus pills, circles and square edges. Existing radius
  utilities resolve to the same geometry.
- The existing 4pt spacing scale now replaces exact matching pixel
  values. Smaller irregular spacing remains for later surface passes.
- Flat Home and player timeline items, sentence-case labels, neutral
  moment symbols, quieter count badges and no gold clan edge. The
  existing filters remain the same controls; they can wrap rather than
  hide an option. Player tabs wrap on phones and retain their keyboard
  behavior.
- The shared control minimum is 44px. Follow and primary actions use
  violet; the legacy `btn--gold` class remains an alias for existing
  consumers. The highlight composer now uses the role name `btn--primary`.
- Home's eight deck cards fit in two rows of four in its side column.
  The prior desktop view clipped the last three cards. This is CSS
  geometry only; card files and avatar crop values are unchanged.

Global token and kit changes are inherited by other pages. Their captures
are regression evidence here, not completed surface redesigns. Dedicated
Find, Stats, Clan, Settings, site and docs passes follow direction approval.
Find's tab row and Stats' mode row still scroll with partial edge labels;
those layouts remain for their surface passes, with their existing labels.
Mail templates are outside this pass.

## Questions and defaults

The question in this draft is visual: whether this restrained direction
is right for Elixir. No product defaults, permissions, routes, navigation
items, data reads, content or wording are changed. The approved product
briefs already define what each surface does; no new decision is entered
in DECISIONS before Jamie reviews the direction.

The requested bell-interaction review is tracked separately in
[#1009](https://github.com/jthingelstad/elixir-mcp/issues/1009). Changing
its drawer behavior, read semantics, destinations or words belongs to
that follow-up. The fixture browser also found that Escape closes its
drawer without returning focus to the trigger; Bell's interaction code
is unchanged here.

## Counts

Run `node tools/design-census.mjs <base-ref>` and
`node tools/design-census.mjs` from the repository root. Root tokens
exclude Tailwind compatibility aliases. Selector counts are qualified
CSS rule blocks, rather than comma-expanded selectors. Comments are
excluded except in the byte count.

| Measure | Before | After |
| --- | ---: | ---: |
| Root tokens | 203 | 167 |
| Type tokens | 32 | 11 |
| Radius tokens | 19 | 4 |
| Selector rule blocks | 1,774 | 1,769 |
| Component source bytes | 233,158 | 230,031 |
| Literal spacing pixel values | 1,161 | 605 |
| Box-shadow declarations | 48 | 46 |
| Component gradients | 11 | 6 |
| App inline styles | 195 | 195 |
| Shared kit inline styles | 9 | 8 |

This first checkpoint makes substantial token reductions but only a small
selector and source-size reduction. The larger stylesheet reduction is
still owed during subsequent surface passes. Home and the player page
already have no inline styles; the app ceiling remains 195, and the kit
now has its own ceiling of 8 after retiring a static FeedbackSheet margin.
Dynamic card-art crop styles stay.

## Tests deliberately changed

- `page-frame.spec.ts`: page and place names now use Inter rather than
  pinning the display face on Clan's title. It also checks roster density
  at 390px and 420px with both loaded and unavailable web fonts. CI
  exposed a 99px roster row that the original local check could measure
  before fonts settled; phone roster metadata now uses the 12px caption
  role so the fixture stays within the original 90px limit in both states.
- `battle-highlight.test.jsx`: pins the primary action's role class,
  replacing the old gold-paint class; the action and its words stay.
- `theme.test.mjs`: the existing radius utility resolves to the single
  radius token.
- `inline-styles.test.js`: extends the ratchet to the shared kit at 8.
- `new-home.spec.ts`: checks that all eight deck cards remain in bounds.
- `player-page.spec.ts`: moves its identical invented player to a shared
  fixture. `home-fixture.ts` accepts an optional capture clock; ordinary
  journeys keep their current clock.
- `design-direction.spec.ts`: captures Home, a player, Find, Stats,
  Clan Members, Settings Usage, the signed-out site and docs, and a battle
  at 390 × 844 and 1280 × 844. It checks real viewport dimensions, page
  bounds and runtime errors. Image decoding is awaited before exports so
  lazy card art cannot leave a blank deck in a published capture.

`npm run verify` passed on Node 24, including all 30 test units, static
checks and Lambda builds. The full `npm run e2e` suite passed 508 journeys.
Native in-app browser review separately exercised Home → Friends → Ada,
player tabs with arrow keys and Enter, and the bell. Phone and desktop
checks found no page overflow or app console errors. The corrected Home
deck exposes all eight cards in bounds.

## Evidence and reproduction

[Before/after gallery](../design/visual-direction/README.md) contains 72
fixture screenshots: nine pages, phone and desktop, first screen and full
page, before and after. The before captures use base `b5541644`'s design
sources; the after captures use this branch. No live player screenshot
is stored or published. All 186 cached card-art files were checked by
SHA-256 against the original cache and are byte-identical; avatar-crops.ts
has no diff.

All 18 before/after body-text comparisons are identical after normalizing
whitespace and CSS casing. The source copy, including the legal notice,
is unchanged. A generated mood sketch informed the direction; the actual
fixture screenshots are the review authority. Content, original icons,
card art and the complete legal notice take precedence over that sketch.

Capture after building, with the installed Node 24 first on PATH:

```sh
ELIXIR_DESIGN_NOW=2026-11-14T14:00:00Z \
ELIXIR_DESIGN_CAPTURE_DIR=/absolute/path/to/captures \
npx playwright test -c apps/web/playwright.config.ts design-direction --project wide --workers 1
```

For an independent interactive browser pass:

```sh
node infra/scripts/build-site.mjs --skip-stats
node tools/design-preview.mts
```

Open `http://127.0.0.1:4388/home`. This preview serves the same invented
fixtures locally; it has no live API. Run builds, verification and browser
journeys serially, since each build replaces the same output directory.
