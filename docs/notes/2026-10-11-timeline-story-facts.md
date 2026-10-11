# 2026-10-11 — Timeline moments carry the story; one move is one story

MCP 11.11.0. JSON API 3.2.0 unchanged. No migration.

## One arena move, posted twice (Andy, 2026-10-09)

The POAP KINGS bot posted one arena promotion twice about two hours apart.
The record held one ledger row; the timeline served one item id twice,
both at revision 1. The first serve (08:53Z) was the roster's
observation; the second (10:34Z) was the same item re-served when the
proving battle arrived (`pinArenaMoment` attaches late proof, the
observed basis serves an item again when `evidence_observed_at` moves),
now with `promoted_by`. Nothing told a reader it was the same story grown:
the revision did not move, and the bot keeps no ledger of ids it told.

- `ledgerStory` gives a crossing kind (arena, league, best) the revision
  of its evidence attachment (`evidence_version`), so late proof comes
  back under the same id at revision 2. Discord cross-posts already edit
  in place on a higher revision.
- No cleanup op: there were no duplicate rows, and the occurred read shows
  one item.
- The bot side (it should not post an id it told at the same or lower
  revision) is an issue in elixir-mcp-discord, not fixed here.

## award_standing named a closed season (season 135)

`standingsFrom` deliberately wrote a closed season's final places beside
the running season's; they read as "now leads ... season 135" on the
timeline. Standings are now the running season only: a closed season's
result is `award_granted`. Between seasons nothing is written, and the
next morning's plan takes the closed season's standings back (its
removes), so the live S135 rows go without an op. DECISIONS "Attested
facts" says so.

## 2v2 sittings: two items, each with its teammate (feedback #370)

Two clanmates' 2v2 sitting produced two identical-looking standouts. Both
sittings are true, so both stay (never thinned). Each now carries
`teammate {player_tag, name, battles}` (the partner with the most battles
in the sitting) and its text says "with <name> in 2v2", so a narrator can
tell the pair once. The teammate is not added to `subjects`: the item is
still that player's sitting.

## session_standout says how (schema version 3)

- `best_win`: the win over the opponent who started it with the most
  trophies (ties: more crowns, then the earlier battle), with battle_id,
  battle_time, type, mode, the opponent(s) with starting_trophies, crowns
  both ways, trophy_change and trophies_after. Absent when no win had a
  rated opponent. `follow` adds a battles_query for it.
- Each crossing names the battle that crossed it (`battle_id`).
- Computed in one query per read over the standouts' spans
  (`sittingDetails`, perf key `clan.sitting_details`), own battles only
  (`OWN_BATTLE_SQL`).

## week_resolved names who carried the week

The text appends "led by A (3,200 points, 16 decks), B (...) and C (...)"
from `facts.members`, the top three by points with points above zero.
Points, never per-member fame (Jamie approved naming members' points
here). The facts are unchanged.

## Not here

Issue #454 is syndication delivery (wake, open window, relay edit race),
not the timeline; another session owns packages/syndication.

## Tests

`packages/tools/test/timeline-standout-story.test.mjs` (2v2 pair,
best_win choice and ties, crossing battle, week text);
`timeline-evidence.test.mjs` (late proof: same id, revision 2);
`packages/clan/test/standings.test.mjs` (running season only, take-back
on close).
