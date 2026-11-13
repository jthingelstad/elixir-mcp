# 2026-11-13 — An opened session on Home is a styled read

Jamie, 2026-11-13: "Opening a session shows the battles in it on home but
is lacking any styling... could show much better info there."

**What changed.** A sitting's Open session on Home's feed and View games on a
player's Timeline now draws `SessionGames` (`apps/web/src/home/SessionGames.jsx`,
CSS `.kit-sgames` / `.kit-sgame` in `packages/design`): the page's battles
newest first, grouped into runs by the deck played (the kit's `DeckRow`,
its label when the deck is classified; the cards are left out when the
page is one run of the deck the item already shows). Each row is the
result and score, the opponents (and a 2v2's teammates) as links to their
player pages, the time, the mode when the sitting mixed modes, a 1v1
opponent's clan, a duel's games, the trophies moved and a Battle link.
Loading, a changed read (Refresh) and paging (25 a page) keep their
states. A milestone item whose count differs from the record says so.
Crossing evidence and the Settings agent timeline are unchanged.

**The read.** `readTimelineEvidence(..., { detail: true })` (web only:
`GET /api/me/home/feed` evidence and `GET /api/player/evidence`) pages
newest first and adds one statement over the page's battle ids for the
reader's player (deck hash, same-side teammates by game name, duel
rounds with the opponent's crowns), then `deckIdentities` for the
page's decks. Five statements for any page, plus the archetype
vocabulary's four on a cold client: nine, the same for 1 game or 25,
pinned with no `player_tag = any(` batch
(`packages/tools/test/timeline-evidence-detail.test.mjs`). MCP's
`elixir_timeline` evidence is unchanged (ascending, no extra fields).

**Left out, on purpose.** A duel game level on crowns has no result (the
tower tiebreak is the battle page's); duel battles carry no deck in the
record, so they sit in a run without cards; nicknames are never read
(game names only); no per-mode win-loss in the panel, since the item
above carries the figures and the bar chart.

MCP and JSON API unchanged.
