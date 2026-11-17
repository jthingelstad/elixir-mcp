# 2026-11-17: Lucide glyphs and a one-tap cheer

Jamie, 2026-11-17: "Do we have a glyph library? It doesn't seem like we
do. I like Lucide glyphs and they would make better reactions than what we
have now. Plus can be used all over the app. Also the Cheer capability for
a post is awkward. And requires two clicks. Let's make that way better."

## Lucide was already there, unevenly

`packages/ui/src/Icon.tsx` has wrapped `lucide-react` since 2026-09-13,
and the site's `{% icon %}` shortcode has inlined `lucide-static` since
2026-09-10.
What made it look absent was everything around it: the six cheers were
emoji, back and forward links were the text characters `‹` and `›`, "yours"
was a `★` character, a done step a `✓`, and Admin's feedback ratings
`👍`/`👎`. This change finishes the job:

- Both packages are pinned to the exact version 1.72.0 (they were carets on
  1.70 and 1.66). ISC licence; the glyph doc carries the note.
- `Icon` takes `label` for a glyph that stands alone (`role="img"`), and is
  `aria-hidden` otherwise. Its map gained the six cheer glyphs and
  `smile-plus`.
- Every text chevron on a control in the app and the site is the Lucide
  chevron (crumbs, "Open", "All", Admin's paging, the docs' tool pages,
  What's new). A `›` inside prose naming a path stays.
- The `★` and `✓` marks are Lucide `star` (filled) and `check`; Admin's
  ratings read "Up" and "Down".
- Left alone: game art, the Elixir mark, a `✓` inside a native `<option>`
  (no SVG can go there), Discord reaction emoji shown in Admin (they are
  Discord's), and mail, push, Discord, RSS and MCP, which keep their words.
- `docs/design/glyphs.md` maps each glyph to its meaning.

JS for the whole app grew 7.3 KB raw, 1.8 KB gzipped (4,937,286 to
4,944,551 bytes raw; 1,696,687 to 1,698,486 gzipped), about 0.1%.

## Why a cheer took two taps

`Cheers.jsx` drew a **Cheer** button that only opened a picker
(`aria-expanded`), and the six chips in it were what cheered. The only
one-tap path was a count chip someone else had already used.

## One tap now

- **Cheer** gives Well played (`well_played`, the first of the six) at
  once: the cache is written before the server answers, the glyph pops
  (only under `prefers-reduced-motion: no-preference`), and the button
  turns violet and says Cheered. A second tap takes yours back, whichever
  kind it is. It is a `button` with `aria-pressed`, and its counts and
  "Yours: …" are its description.
- **The smile beside it** (`aria-expanded`, "Choose a cheer") opens the
  six inline under the row, as a labelled group of toggles. Arrow keys,
  Home and End move, Enter chooses, Escape closes and returns focus. A
  keyboard open puts focus on yours, else the first. On touch, holding
  Cheer for 450 ms opens them too, and the click that ends the press is not
  a cheer. No sheet or dialog.
- **A scroll never cheers:** the button acts on `click`, which the browser
  does not send when a touch becomes a scroll (`pointercancel`), and a
  finger that drifts 10 px cancels the long press.
- **Counts** sit beside the button as glyph and number (yours in violet),
  with "You and 2 others" after them. Never who. A count is no longer a
  button: tapping someone else's kind now goes through the six.
- **No layout shift:** the button reserves the width of its longer word.
- **Failure:** the mutation rolls the cache back and the item says "Your
  cheer was not saved. Try again." (`role="status"`). Writes for an item
  are serialised: a tap during a write shows at once and is sent when the
  write answers, so the buttons never go disabled and answers never land
  out of order. The rate limit (120 an hour) and blocked states are the
  server's, unchanged.
- **Surfaces:** feed cards; one-line short sessions (compact: the glyph
  and total, and the smile, each 44 px); a closed group of short sessions
  takes no cheer, since a cheer is one session's and a group has no id, and
  opened each line has its own; a player's page and a battle's page as
  before; a session's page now has Cheer under its figures while the
  session is in your feed. Clan's Feed takes no cheers (its standing rule).
  The bell's counts use the same glyphs. Agents' pages show the counts and
  nothing to press.

No API, contract or MCP change: the same `PUT /api/me/cheers` with the same
six ids.

## Tests

`apps/web/test/cheers.test.jsx`: one tap and undo, another kind, the
keyboard path, a scroll and a long press, rollback, queued taps, agents'
pages, the compact line, and the one map (each kind's glyph, the same on
cards, counts and the six, and a scan that no app source still holds the
old emoji). `apps/web/e2e/cheer-tap.spec.ts`: the same journeys at 390 and
1280 with axe, 44 px targets and no height change, no sideways scroll at
320 with the six open, and a scan of the Timeline, Settings and a session's
page for icon-only controls without a name. `e2e/glyph-shots.spec.ts`
saves the review pictures when `GLYPH_SHOTS` names a folder.
