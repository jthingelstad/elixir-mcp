# 2026-10-21 — cards_card reads a card's decks once

The platform review (2026-10-21, §2) listed `cards_card` among the slow
tools: 48 calls in seven days, nearly all acceptance runs, p50 1.4 to
3.1 s and p95 11.9 s. `{profile_tool}` on POAP KINGS and The Log put
1.1 to 1.6 s warm (7.5 s cold, 8,347 blocks read) in one statement,
`first_played`: the planner probed `deck_card`'s primary key once for
each of the 10,192 decks the clan has played, because it expected far
fewer.

`first_played` now reads the card's decks once from `deck_card_card`
(card_id, form, deck_hash), materialized, and hash-joins them to the
first play of each deck the selection played. That side is bounded by
how many recorded decks hold the card, not by the length of the history.
The statement is `firstPlayedSql` in `card-profile.mjs`;
`packages/tools/test/card-first-played.test.mjs` keeps the old statement
as the reference, requires the same rows for every card and selection
over a seeded record, and shows that with the planner forced into a
nested loop the old one probes `deck_card` per deck and the new one reads
it once.

Left as they were, with the evidence:

- A tower troop's first play still joins `deck` by primary key (10,192
  probes, 1.4 s warm for Tower Princess). `deck` has no index on
  `tower_troop_id`, and no acceptance case or recent call asks for a
  tower troop.
- `members.played` for a clan probes `battle_participant_card` once per
  game in the window, for the level played (95 ms warm for The Log,
  827 ms for Tower Princess, which nearly every game carries). That
  is the size of the answer, not a walk.

No answer changes; no contract or JSON API change (MCP 11.13.3, JSON
API 3.2.1). Deployed with `--acceptance=cards`.
