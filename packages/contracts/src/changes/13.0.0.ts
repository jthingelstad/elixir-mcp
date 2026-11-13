import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.0.0",
  date: "2026-11-13",
  summary: md(
    'The last analysis-era reads retire (DECISIONS "Every read names a player or a clan; the analysis-era reads are retired"). Every read now names a player or a clan; none reads a population or the whole record:',
    list(
      "`cards_card` retires: read `cards_catalog` (`ids` or `query`) for a card's facts and art, and `battles_cards` or `battles_query` (`with_card`) for a player's play of it.",
      "`badges_rarity` and `badges_holders` retire: a player's badges stay on `players_profile`, labelled as before.",
      '`battles_performance` takes no `segment`: it reads one player, with `group_by: "week"` for weekly rows.',
      "`battles_query` with `deck_hash` and no player no longer reads every player on the deck, and serves no `deck_stats`: `deck_hash` narrows one player's battles (the caller's when `player_tag` is omitted).",
      "`elixir_collectors` serves no `points` or `quota_credits`, zero since 2026-10-12.",
    ),
    "The `segment` argument is gone from every tool, and the `clans:attest` OAuth scope retires: a client that still asks for it signs in without it, and a grant that held it keeps every other capability. Refresh tools/list. The JSON API is 4.0.1, a patch: no operation's response changed, and `clans:attest` leaves the scopes it lists.",
  ),
  breaking:
    "Retired with no alias: cards_card (read cards_catalog, battles_cards or battles_query with_card), badges_rarity and badges_holders (a player's badges are on players_profile). battles_performance's segment argument and its weeks[] (use group_by: \"week\" on one player). battles_query's corpus deck mode: deck_hash with no player now reads the caller's battles on that deck, and deck_stats is gone. elixir_collectors' points and quota_credits. The clans:attest OAuth scope (dropped from requests and stored grants, never refused).",
} satisfies ChangelogEntry;
