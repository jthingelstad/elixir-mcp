# 2026-11-17 — Reactions are glyphs alone, and there are twenty

Jamie, 2026-11-17, after the one-tap cheer (`2026-11-17-lucide-cheers.md`):
"Reactions should not need words next to them. And give more options."
Then: "Give 6 reactions to the user and even more on a tap for more
options."

## The control

- **The cheer button** is a glyph and its kind's count, no word: the
  thumbs up (Well played) until you cheer, then your kind's glyph, filled.
  One tap cheers, another takes yours back. Its name is
  "Cheer: Well played" or "Cheered: Royal"; the counts in words ("Wow 2,
  Royal 1. You and 2 others") are its description, for screen readers only.
- **The smile** (`smile-plus`, the same glyph open or shut, lit while
  open) opens a popover anchored to the row. It floats over the content,
  so opening it moves nothing. Level one is the six of 2026-11-12 in their
  fixed order, an optional slot, and More (`plus`, "More reactions").
- **More** grows the popover in place to all twenty, a grid five across,
  growing downward (upward when there is no room below). It is kept inside
  the screen sideways; at 320 px the row of seven is 312 px wide.
- **The slot before More** holds yours when it is from past the six, else
  your last pick from past the six on this device (local storage, a
  convenience; nothing is stored on the server). It is hidden under 380 px
  wide unless it is yours, so the row of seven always fits.
- **Names:** every glyph-only button has an `aria-label` with its state
  (`aria-pressed`), and a tooltip shows the name on hover, on keyboard
  focus (not a tap's focus) and on a long press, which is never a cheer.
- **Keyboard:** the arrows move (the grid in two dimensions, wrapping),
  Home and End jump to the ends, Enter chooses and puts focus back on the
  cheer button, Escape steps back from the grid to the six (on More), then
  closes (on the smile).
- Unchanged from the one-tap work: the optimistic write and its rollback,
  the per-item queue in tap order, a scroll that starts on the button never
  cheering, reduced motion, and no layout shift.

## The set

All positive or playful, kid-safe, distinct at 20 px, and none a glyph that
already means something (`docs/design/glyphs.md`). The six keep their ids;
Royal's glyph moved from `crown` (a Ranked league and the game's crowns) to
`gem`. The fourteen: Love it (`heart`), Good game (`handshake`), Congrats
(`party-popper`), Clutch (`zap`), High five (`hand`), Champion (`medal`),
Nailed it (`target`), Climbing (`rocket`), Big brain (`brain`), Ice cold
(`snowflake`), Close one (`hourglass`), Lucky (`clover`), Fun to watch
(`popcorn`), Getting better (`sprout`). Left out: trophy, swords, shield,
castle, crown and eye (they already mean something here), ghost and cat
(unclear what they say), and anything that could read as mocking. The
bell's reaction row moved from `heart` to `smile`, since `heart` is now
Love it.

## Counts

`foldCounts` in `cheer-set.js`: the button shows its own kind's count;
beside it, the top three other kinds by count (ties in the set's order),
yours always among them, and the rest as one "+N". Unknown kinds (a newer
server's) are never drawn and count in the "+N"; an unknown `my_cheer`
shows the default glyph, pressed, and a tap takes it back. A line's
compact control shows the button and "+N" only. The bell's reaction rows
fold the same way. Never who.

## What else names a kind

- **Database:** 0291 replaces `timeline_cheer_cheer_check` with the twenty
  (drop and add `NOT VALID` in one file, as 0284 did; every stored value
  is one of the six, so nothing can fail it). A later file may validate it.
- **MCP 13.7.0** (a minor): `elixir_cheers` may count the fourteen new
  keys; its description and output schema name them. Acceptance's
  docs-provenance check sees the ids in timeline#cheers, so each is allowed
  in `acceptance/catalogue-allow.json` until an account has one.
  The JSON API is unchanged.
- **Mail, push, the activity mail, the digest, RSS and Discord** never name
  a kind ("N cheers"), so their words are unchanged.
- **Agents' pages** show the folded counts as one image named in words.

## Deploying

The migration runs before the code flips. Until then the old code refuses
the new kinds (its list is the six), so nothing new is written. A page
cached from before the deploy draws only the kinds it knows, counts the
rest in "+N", and shows the default glyph for a kind it does not know.
