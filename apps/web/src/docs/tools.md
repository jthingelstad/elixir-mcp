# Tools

Every tool your agent sees through the MCP connection, grouped the way
the [Clash Royale API agent docs](https://github.com/jthingelstad/cr-agent-api-docs)
outline the game's surface — plus two groups of our own. The same
grouping rides each tool's title (`Players · Player profile`), so
clients that list tools alphabetically cluster them. Write tools all
live in the Elixir MCP group (feedback and the two watch requests);
only **Live CR API fetch** reaches outside the recorded corpus.

## Players

Profile-shaped views of one tag.

- **Player profile** (`players_profile`) — latest recorded snapshot: trophies,
  donations, lifetime stats, clan.
- **Player summary** (`players_summary`) — the headline in one call:
  last-30-days record, most-played deck, best deck.
- **Player timeline** (`players_timeline`) — daily trophy/donation
  series from snapshots.
- **Card collection** (`players_collection`) — owned cards at in-game levels.

## Battles

The recorded battle corpus and statistics over it.

- **Query battles** (`battles_query`) — the workhorse: filtered,
  cursor-paginated battles with both sides' decks.
- **Performance windows** (`battles_performance`) — win rates over windows,
  weekly trend, before/after splits.
- **Deck performance** (`battles_decks`) — per-deck records.
- **Card performance** (`battles_cards`) — per-card win-rate
  impact, yours and opponents'.
- **Compare players** (`battles_compare`) — 2–4 entitled tags side by
  side over a shared window.
- **Level Curve & Pilot Score** (`battles_levels`) — how much card-level
  advantage is worth, measured across the corpus; pass a tag for the
  Pilot Score: wins your card levels can't explain, with a monthly
  trend. Numbers with receipts — every bin ships its sample size.

## Clans

- **Clan roster** (`clans_roster`) — members, roles, donations, tenure as
  observed, recent joins/leaves.
- **Clan standings** (`clans_standings`) — every member's recorded win
  rate over a window, ranked with the clan median: the "am I above
  average?" view.

## War

River race, current and historical.

- **Current war** (`war_current`) — standings, per-member points, attendance
  by war day.
- **War history** (`war_history`) — recorded weeks with ranks and
  fame; optional one-member focus.
- **Scouting Report** (`war_rivals`) — observed war history for rival
  clans: every recorded race captures all five bracket clans, so rivals
  accumulate fingerprints across seasons.

## Cards

- **Card catalog** (`cards_catalog`) — the global card list as the
  game serves it.

## Live

- **Live CR API fetch** (`live_fetch`) — one raw live fetch through the
  collector fleet (capped per day; raw API shapes, not normalized).

## Elixir MCP

The service itself.

- **My claimed players** (`elixir_my_players`) — session bootstrap: your
  claims, recording status, current clan.
- **Record coverage** (`elixir_coverage`) — how complete the record is for
  a tag; use it to caveat answers honestly.
- **Send feedback** (`elixir_feedback`) — file feedback with the
  maintainer, attributed to your account.
- **Watch player** (`elixir_watch_player`) — claim a tag and start
  recording it, same caps as the website.
- **Watch clan** (`elixir_watch_clan`) — request clan recording at
  either scope: `activity` (the clan itself) or `comprehensive` (plus
  every member's battles, membership-following). Reviewed by the
  maintainer; clan capture spends the shared budget.
- **Data insights** (`elixir_data_insights`) — corpus-wide transparency:
  players, battles and their span, war weeks, active recordings.
- **Collector ladder** (`elixir_collectors`) — the operator machines,
  their card names, points, and arena tiers.
