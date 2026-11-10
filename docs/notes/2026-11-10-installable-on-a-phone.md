# 2026-11-10 — Elixir installs on a phone

Jamie (2026-11-10): "We should package up Elixir MCP so that it can be
installed as a PWA on a phone ... It'd be ideal for it to be very phone
native", and the phone's tab bar "could be more distinct and brighter".
This reverses the "no PWA" clause of the 2026-09 ecosystem decision.

What shipped:

- **A web app manifest**, `apps/web/public/manifest.webmanifest`
  (`application/manifest+json` in the publisher's `CONTENT_TYPES`):
  `start_url` and `id` `/home`, scope `/`, `standalone`, the bar's colour
  as `theme_color`, and Timeline, Ladder and Clan as shortcuts.
- **Icons from the Elixir logo**, replacing the placeholder diamond: 180
  (Apple touch), 192 and 512, and a 512 maskable with the logo inside the
  safe zone, on the ground colour. Rendered from the 512 px logo with
  Chromium's canvas and quantized with pngquant.
- **One set of head tags** in `apps/web/index.html` and the site's
  `base.njk`: the manifest, the touch icon, `theme-color`, the Apple
  web-app tags with a `black-translucent` status bar, and
  `viewport-fit=cover`. A site test pins the tags on every page and the
  icons' real sizes against the manifest; the build refuses a tree
  without them.
- **Safe areas:** the top bar starts under the status bar, a fixed strip
  the bar's colour covers the clock while the page scrolls, the tab bar
  and the full-screen search and help sheets clear the home indicator.
  All of them are zero in a browser tab.
- **The phone's tab bar** (`.kit-bottom`): the raised panel colour, a
  `--line-strong` top rule and an upward shadow, 22 px icons, 60 px tabs,
  and a filled `--accent-deep` pill behind the current tab's icon.
- **Fields at 16 px on a phone**, so iOS never zooms the page when one
  takes focus.

Not done, by default [engineering]: no service worker. Chrome and Safari
install without one, and a worker caching an origin that also serves
MCP, OAuth and signed-in server renders is a risk this change does not
need. An offline page is the first thing one would add.

MCP 11.18.6 and JSON API 3.4.0 unchanged.
