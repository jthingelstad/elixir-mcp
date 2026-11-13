# Every read names a player or a clan

Elixir is about the players you follow and your clan. The last tools that
read a crowd instead are gone:

- **`cards_card`**: `cards_catalog` has a card's facts and art, and
  `battles_cards` or `battles_query` with `with_card` show how a player
  played it.
- **`badges_rarity`** and **`badges_holders`**: a player's badges are still
  on `players_profile`, with their labels.
- **`segment`** on `battles_performance`: read one player, and pass
  `group_by: "week"` for their week-by-week record.
- **A deck across every player**: `battles_query` with a `deck_hash` now
  shows one player's battles on that deck (yours when you name no one),
  and serves no `deck_stats`.

`elixir_collectors` drops `points` and `quota_credits`, which have been
zero since October. The `clans:attest` connection permission retires too:
an app that still asks for it connects without it, and nothing you
already connected stops working.

MCP 13.0.0, a major: refresh your tool list. The JSON API is 4.0.1, and
no response changed.
