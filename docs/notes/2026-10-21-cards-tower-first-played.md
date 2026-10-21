# 2026-10-21 — cards_card finds a tower troop's first play oldest first

`2026-10-21-cards-first-played.md` left a tower troop's `first_played`
joining `deck` by primary key, saying no acceptance case or recent call
asked for one. That was wrong: gym cases 326.1 and 326.5 ask for Dagger
Duchess (159000002) over POAP KINGS on every full acceptance run, and
took 10.2 s each after the 10-21 deploy. `{profile_tool}` put 1.1 s
warm and 14.2 s cold (9,748 blocks read) in that one statement: 10,192
lookups of `deck`, one per deck the clan has played, to find a tower
troop the clan first played on its first days of recorded history.

The tower troop's first play is now the earliest deck played whose
tower troop it is. The decks played are taken oldest first and each is
looked up by primary key until one matches. The lookup is a scalar
subquery, so the planner cannot turn it into a join that scans `deck`
(63 MB of heap). No index was added: `deck.tower_troop_id` has none,
one would be about 9 MB, and the database is short of memory (#630). A
tower troop the selection never played still looks up every deck
played, as the join did.

`packages/tools/test/card-first-played.test.mjs` keeps the old tower
statement as the reference and requires the same row for played and
unplayed tower troops. With the planner forced into a nested loop, it
shows the old statement looking up every deck played and the new one
stopping within a few.

Left as it was, with the evidence: `members.played` for a clan over
the current season checks each game in the window for the card (6,944
`deck_card` primary-key lookups for Witch) and reads the level played
for each game with it (1,734). That was 1.3 s warm and 5.7 s cold. It
grows with the window, not the history, and reading the card's decks
once instead would hold a hash of 23,000 or more decks in memory.

No answer changes; no contract or JSON API change (MCP 11.13.3, JSON
API 3.2.1). Deployed with `--acceptance=cards`.
