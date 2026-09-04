# Tools

Every tool your agent sees through the MCP connection, grouped the way
the [Clash Royale API agent docs](https://github.com/jthingelstad/cr-agent-api-docs)
outline the game's surface — plus two groups of our own. The same
grouping rides each tool's title (`Players · Player profile`), so
clients that list tools alphabetically cluster them. All tools are
read-only except **Send feedback**; only **Live CR API fetch** reaches
outside the recorded corpus.

## Players

Profile-shaped views of one tag.

- **Player profile** (`get_player`) — latest recorded snapshot: trophies,
  donations, lifetime stats, clan.
- **Player summary** (`get_player_summary`) — the headline in one call:
  last-30-days record, most-played deck, best deck.
- **Player timeline** (`get_player_timeline`) — daily trophy/donation
  series from snapshots.
- **Card collection** (`get_collection`) — owned cards at in-game levels.

## Battles

The recorded battle corpus and statistics over it.

- **Query battles** (`query_battles`) — the workhorse: filtered,
  cursor-paginated battles with both sides' decks.
- **Performance windows** (`get_performance`) — win rates over windows,
  weekly trend, before/after splits.
- **Deck performance** (`get_deck_performance`) — per-deck records.
- **Card performance** (`get_card_performance`) — per-card win-rate
  impact, yours and opponents'.
- **Compare players** (`compare_players`) — 2–4 entitled tags side by
  side over a shared window.

## Clans

- **Clan roster** (`get_clan`) — members, roles, donations, tenure as
  observed, recent joins/leaves.

## War

River race, current and historical.

- **Current war** (`get_war`) — standings, per-member points, attendance
  by war day.
- **War history** (`get_war_history`) — recorded weeks with ranks and
  fame; optional one-member focus.

## Cards

- **Card catalog** (`get_card_catalog`) — the global card list as the
  game serves it.

## Live

- **Live CR API fetch** (`cr_api_live`) — one raw live fetch through the
  collector fleet (capped per day; raw API shapes, not normalized).

## Elixir MCP

The service itself.

- **My claimed players** (`list_my_players`) — session bootstrap: your
  claims, recording status, current clan.
- **Record coverage** (`get_coverage`) — how complete the record is for
  a tag; use it to caveat answers honestly.
- **Send feedback** (`send_feedback`) — file feedback with the
  maintainer, attributed to your account. The one write tool.
