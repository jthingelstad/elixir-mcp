# 2026-11-17 — Notifications is a dropdown by your avatar

Jamie, 2026-11-17: "I think the bell should move off the bottom and become a
notification drop down next to your profile icon in the upper right."

## What changed

- **The bell left the phone's tabs.** The bottom bar is four tabs (Timeline,
  Find, Clan, Profile), in the app (`Shell.jsx`) and on static pages
  (`base.njk`). The manifest's `bell.tab` word ("Bell") is gone with it, so
  the bell's only label is **Notifications**, as "Timeline, Profile and
  Notifications" already had it on a wide screen.
- **The bell is in the top bar at every width,** between Help and the
  avatar. It was already there on a wide screen; a phone rule hid it. Its
  glyph is Lucide `bell` at 20px in a 44px target, the count badge as
  before.
- **It opens a dropdown in place at every width.** The same `<dialog>` as
  before (`BellSheet`), placed under the bell: on a wide screen the 400px
  box it already was; on a phone the screen's width less 8px a side (and
  the safe areas), from just under the bar to just above the tabs, with the
  scrim behind it and `html { overflow: hidden }` while it is open so the
  page cannot scroll behind. Its entrance is the wide screen's short drop
  (the old slide up from the foot is gone); reduced motion has none. A
  dropdown opened without a button (`/timeline?bell`, a page's own
  `open("bell")`) finds the bar's bell to sit under.
- **The button says it is open:** `aria-expanded`, and `aria-controls`
  naming the dialog (`bell-sheet`) while it is open; a pressed look while
  open. Focus moves to the list's title and back to the bell on Escape,
  Close and a tap outside, as before.

## Calls made [engineering]

- **No Notifications page.** The bell's read is capped (`LIST_CAP` in
  `services/web-api/src/bell.mjs`), so the dropdown holds all of it and
  needs no "See all". `/timeline?bell`, which static pages and old links
  use, keeps opening the dropdown.
- **The phone's dropdown stops above the tabs** rather than covering them,
  so it reads as hanging from the bar, not as a sheet.
- **The page is dimmed on a phone, not on a wide screen.** On a phone the
  dropdown covers most of the page and holds it still; on a wide screen it
  stays a light popover over a live page, as since #1009.
- **The scroll lock is phone width only:** a desktop's classic scrollbar
  would shift the page when hidden.

## Tests

`apps/web/test/shell.test.jsx` pins four phone tabs, the bell beside the
avatar and its `aria-expanded`/`aria-controls` round trip;
`apps/site/test/site.test.mjs` pins the static page's four tabs;
`apps/web/e2e/bell.spec.ts` runs every state at 320, 390 and 1280 with
axe: the bell next to the avatar at 44px, the dropdown under it (the
phone's 8px margins and its end above the tabs), the address unchanged,
nothing moving when it opens, the page holding still under a wheel on a
phone, a tap outside at 390 and 1280. No server or contract change.
