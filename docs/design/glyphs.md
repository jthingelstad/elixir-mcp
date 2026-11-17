# Glyphs

Elixir draws its interface glyphs with [Lucide](https://lucide.dev): the
app through `lucide-react`, the site through `lucide-static`, both pinned
to the same exact version (1.72.0 as of 2026-11-17) and both under the ISC
licence (Lucide's own; the repository keeps no separate third-party
listing, so this line is the record). "Lucide is the glyph library" is in
`docs/DECISIONS.md`.

## The one seam

- **App:** `Icon` in `packages/ui/src/Icon.tsx`. Named imports only, so
  the bundle carries the glyphs the map names and no others. A glyph not in
  the map renders nothing: add it to the map, never import Lucide in a view.
- **Site:** the `{% icon "name", size %}` shortcode in
  `apps/site/eleventy.config.mjs`, which inlines the SVG from
  `lucide-static` at build time (no script).

The conventions both follow:

- 18px by default (14 to 16 beside small text), stroke 1.9, `currentColor`,
  so a glyph takes its text's colour and its state's.
- Decorative beside words: `aria-hidden="true"`, and the words name the
  control.
- Alone: give `label` (`role="img"` with that name), or put the name on
  the button (`aria-label`), never both. `e2e/cheer-tap.spec.ts` scans the
  Timeline, Settings and a session's page for a button or link holding only
  a glyph with no name.
- The class `lucide-<name>` is on every glyph, app and site, so CSS and
  tests can find one by name.

## Never a Lucide glyph

Game art is the game's: card art, arena and league art, clan badges,
Stamps' art and the Elixir mark stay as they are (card art is never
altered). Mail stays as it is too: email clients drop inline SVG, so a
message keeps its words, and so do push, Discord, RSS and MCP.

## What each glyph means

### Cheers (one map: `apps/web/src/home/cheer-set.js`)

| Cheer | Stored id | Glyph |
| --- | --- | --- |
| Well played (the one-tap default) | `well_played` | `thumbs-up` |
| On fire | `on_fire` | `flame` |
| Royal | `royal` | `crown` |
| Wow | `wow` | `sparkles` |
| Ha | `ha` | `laugh` |
| Grind | `grind` | `biceps-flexed` |

`CheerGlyph` draws a kind from this map and nothing else does: the feed's
cards and lines, a session's page, a battle's page, a player's page and the
bell all show a kind the same way. Yours is filled (the glyph tinted, the
button violet); everyone else's is the outline. `smile-plus` opens the six
and `x` closes them.

### Everywhere else

| Glyph | Means |
| --- | --- |
| `house`, `search`, `users`, `user-round`, `bell` | The tabs: Timeline, Find, Clan, Profile, Notifications |
| `chevron-left` | Back to the page above (a crumb, a Back link) |
| `chevron-right` | Opens the row or page it ends ("Open", "All", a row's link) |
| `chevron-down`, `chevron-up` | Opens or closes in place (a folded group, a section) |
| `x` | Closes a sheet, a panel or the cheer kinds |
| `star` (filled) | Yours: your clan, your close friend |
| `check` | Done (a step, a perfect attendance) |
| `copy`, `link-2` | Copy, a link (sharing a session or a battle) |
| `external-link`, `arrow-up-right` | Leaves Elixir |
| `user-plus` | Follow |
| The Settings rail's glyphs | Named in `apps/web/src/lib/settings.js`, one per page |

Words in prose that name a path ("Settings › Comments") keep their `›`: it is
punctuation there, not a control.
