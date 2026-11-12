# 2026-11-12 — The signed-out shell, You with Stats, and the bell

Part of the design canvas's remaining pieces. Jamie, 2026-11-12: "Approved:
build the remaining canvas pieces (bell, cheers on battle and player pages,
Home side panel, Find, You with Stats, Clan Members follow-all and map,
signed-out shell, Settings slots)". This change is three of them: the
signed-out shell, You with Stats, and the bell. DECISIONS: three new lines,
"The bell is what is about you", "You is your own player page, with Stats"
and "Signed out: sign in or join", and tails on "Reactions, not comments",
"Home is one feed", "Home reads, it never evaluates" and "One origin, paths
not hostnames". Briefs: `docs/product/structure.md`, `home.md`.

## What changed

- **Migration 0244, expand only.** `bell_seen` (account, `seen_at`): the
  bell's seen marker, one row per account. `ops-account-remove` deletes it.
- **The bell's read.** `GET /api/me/bell` (`services/web-api/src/bell.mjs`,
  route `src/routes/bell.mjs`) for a person only (an agent is refused
  `not_entitled`; not in `AGENT_SCOPED_ROUTES`), 120 an hour on
  `bell#<account>`:
  - *Reactions*: the timeline of the account's verified own players (primary
    and alts) over seven days, rebuilt at read time, joined to
    `timeline_cheer` rows by other accounts; each item's counts by cheer and
    its total, never an account. An item is new while a cheer on it changed
    after the marker. At most 20, latest cheer first.
  - *Followers*: person accounts' friend claims on those players made in the
    last thirty days, each named by the follower's own verified player's game
    name and tag, otherwise counted (`unnamed`). No follow time is shown.
  - *Answers*: the account's feedback with a response, unread or answered in
    the last thirty days, the message clipped to 90 characters; new while
    unread.
  - `new` sums them. `PUT /api/me/bell/seen` (contract header required) moves
    the marker to now.
- **The bell's sheet** (`apps/web/src/shell/Bell.jsx`, `bell-logic.js`):
  Reactions to your items, New followers, Needs you (unchanged) and Answers to
  your feedback, each only when it has something; a gold dot marks a new row,
  read as "New:". Opening it reads the bell fresh and moves the marker once;
  what was new stays marked while it is open. The dot on the bar is lit by
  Needs you plus `new`, and the bar reads "Notifications, N new".
- **You** (`apps/web/src/home/You.jsx`): the player page of the primary
  player once verified (`PlayerView` with an extra Stats tab; `?tab=` picks
  a player tab), then your other players (private), Your account and sign
  out. With no verified primary: Verify your player, and Your stats when an
  own player exists.
- **Stats** is Ladder's route at `/home/you/stats[/battles|decks|cards]`
  (`LADDER` in `ladder/ladder.js`) under You's tabs (`YouTabs`), the scope
  bar and four tabs unchanged. `ladderMoved` maps every `/ladder` path to the
  same page (`/ladder/days` to battles, an unknown page to the season) and
  `movedTo` reads it; the query and hash ride along, so mail's
  `/ladder?player=` and `?season=` links land. CloudFront and the site's
  router still hand `/ladder` to the app. Reader-facing words say Stats;
  code and the feedback area keep `ladder`. The manifest's shortcut opens
  Stats.
- **Signed out.** `family.json`'s `signedOut` is Docs alone; the bar is the
  logo, Docs, Sign in and Create account. Play Drop left the bar (app and
  site) for the account menu and the footer, which already carried it,
  Cards and Updates. The site's front page leads with the gate ("Keep up
  with your friends in Clash Royale", Create an account, Sign in; signed in,
  Open Elixir) and keeps the parts of Elixir below it, less the Ladder tile.
  Nothing public became private: no route changed its access, and the
  public-boundary test needed no change.

## Defaults taken [engineering]

Reactions only on verified own players' items over seven days; followers over
thirty days with no time shown; answers unread or from the last thirty days,
read in Settings rather than by opening the bell; You is the primary player
only (alts listed, each to its own page); Stats still reads unverified own
players, as Ladder did; the Stats address under `/home/you`; the signed-out
home stays the site's page with the gate on top; mail keeps `/ladder` links
and relies on the redirect.

MCP and the JSON API unchanged. Migration 0244.
