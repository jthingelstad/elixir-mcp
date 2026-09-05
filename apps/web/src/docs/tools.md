# Tools

Every tool your agent sees through the MCP connection, grouped the way
the [Clash Royale API agent docs](https://github.com/jthingelstad/cr-agent-api-docs)
outline the game's surface — plus two groups of our own. The same
grouping rides each tool's title (`Players · Player profile`), so
clients that list tools alphabetically cluster them. Write tools all
live in the Elixir MCP group (feedback and the two add tools);
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
- **Find player by name** (`players_search`) — name-to-tag within your
  entitled scope; unknown names return an honest empty, never a guess.

## Battles

The recorded battle corpus and statistics over it.

- **Query battles** (`battles_query`) — the workhorse: filtered,
  cursor-paginated battles with both sides' decks; `game_mode` filters
  by the game's own mode names (event modes included).
- **Performance windows** (`battles_performance`) — win rates over windows,
  weekly trend, before/after splits, and per-mode discovery
  (`group_by: mode` — every named mode played, event rotations included).
- **Deck performance** (`battles_decks`) — per-deck records.
- **Card performance** (`battles_cards`) — per-card win-rate
  impact, yours and opponents'.
- **Compare players** (`battles_compare`) — 2–4 entitled tags side by
  side over a shared window.
- **Meta decks / Meta cards (observed)** (`battles_meta_decks`,
  `battles_meta_cards`) — the observed meta for any segment (corpus,
  clan, player, or a collection like the pros): usage shares,
  distinct-pilot counts, and EB-shrunk win rates; evolution forms never
  merge. Observation, never opinion.
- **Segment trends** (`battles_trends`) — weekly series (battles,
  record, win rate, active players, net trophies) for the same
  segments.
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
- **Clan Pilot Scores** (`clans_pilot_scores`) — every member's Pilot
  Score in one call: wins their card levels can't explain, clan-wide.

## War

River race, current and historical.

- **Current war** (`war_current`) — standings, per-member points, attendance
  by war day.
- **War history** (`war_history`) — recorded weeks with ranks and
  fame; optional one-member focus.
- **Scouting Report** (`war_rivals`) — observed war history for rival
  clans: every recorded race captures all five bracket clans, so rivals
  accumulate fingerprints across seasons.

## Collections

- **Browse collections** (`collections_browse`) — curated,
  owner-published groupings: pros, creators, clan families.
- **Collection members** (`collections_get`) — one collection's members,
  enriched; fan into the player tools per tag from there.

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
- **My feedback** (`elixir_my_feedback`) — everything you've filed with
  status, maintainer response, and ship links; feedback is never
  actioned invisibly.
- **Changelog** (`elixir_changelog`) — what shipped since any contract
  version; how agents discover capabilities that landed mid-session.
- **Add player** (`elixir_add_player`) — add a tag to your account:
  claimed AND recorded in one act, within your tier's slots; the only
  per-tag setting is notify (your event pipe).
- **Add clan** (`elixir_add_clan`) — add a clan: recorded immediately
  at activity or comprehensive scope, within your tier's slots; notify
  controls your event pipe; remove settles the shared recording.
  every member's battles, membership-following). Reviewed by the
  maintainer; clan capture spends the shared budget.
- **Data insights** (`elixir_data_insights`) — corpus-wide transparency:
  players, battles and their span, war weeks, active recordings.
- **Collector ladder** (`elixir_collectors`) — the operator machines,
  their card names, points, and arena tiers.
