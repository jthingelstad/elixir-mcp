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

Twenty since 2026-11-17 ("Reactions are glyphs alone; a larger set").
The first six open first, in this fixed order; More shows the rest.

| Cheer | Stored id | Glyph |
| --- | --- | --- |
| Well played (the one-tap default) | `well_played` | `thumbs-up` |
| On fire | `on_fire` | `flame` |
| Royal | `royal` | `gem` (`crown` until 2026-11-17) |
| Wow | `wow` | `sparkles` |
| Ha | `ha` | `laugh` |
| Grind | `grind` | `biceps-flexed` |
| Love it | `love_it` | `heart` |
| Good game | `good_game` | `handshake` |
| Congrats | `congrats` | `party-popper` |
| Clutch | `clutch` | `zap` |
| High five | `high_five` | `hand` |
| Champion | `champion` | `medal` |
| Nailed it | `nailed_it` | `target` |
| Climbing | `climbing` | `rocket` |
| Big brain | `big_brain` | `brain` |
| Ice cold | `ice_cold` | `snowflake` |
| Close one | `close_one` | `hourglass` |
| Lucky | `lucky` | `clover` |
| Fun to watch | `fun_to_watch` | `popcorn` |
| Getting better | `getting_better` | `sprout` |

`CheerGlyph` draws a kind from this map and nothing else does: the feed's
cards and lines, a session's page, a battle's page, a player's page and the
bell all show a kind the same way. Yours is filled (the glyph tinted, the
button violet); everyone else's is the outline. A cheer glyph is shown
alone, never beside its name: the name is the control's `aria-label` and a
tooltip on hover, keyboard focus and a long press. `smile-plus` opens the
six (and stays while they are open, lit); `plus` is More reactions.

Kept off the cheers because they already mean something here: `crown`
(a Ranked league, the game's crowns), `star` (close friend), `bell`
(Notifications), `trophy`, `award`, `castle`, `shield`, `swords`, `eye`.
`heart` was the bell's reaction row until 2026-11-17; that row is `smile`
now. `rocket` is also the docs index's "New here?" mark, on another
surface, which is fine. Every cheer kind is positive or playful and
kid-safe: no thumbs-down, anger, skull, mocking or romantic kinds.

### Everywhere else

| Glyph | Means |
| --- | --- |
| `house`, `search`, `users`, `user-round`, `bell` | The tabs: Timeline, Find, Clan, Profile, Notifications |
| `chevron-left` | Back to the page above (a crumb, a Back link) |
| `chevron-right` | Opens the row or page it ends ("Open", "All", a row's link) |
| `chevron-down`, `chevron-up` | Opens or closes in place (a folded group, a section) |
| `x` | Closes a sheet or a panel |
| `star` (filled) | Yours: your clan, your close friend |
| `check` | Done (a step, a perfect attendance) |
| `share-2` | Share a Timeline item, session or battle. The button is named “Share”. |
| `copy`, `link-2` | Copy, a link (sharing a session or a battle) |
| `external-link`, `arrow-up-right` | Leaves Elixir |
| `user-plus` | Follow |
| The Settings rail's glyphs | Named in `apps/web/src/lib/settings.js`, one per page |

Words in prose that name a path ("Settings › Comments") keep their `›`: it is
punctuation there, not a control.
