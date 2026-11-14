# 2026-11-13 — A duel game's left-out King Tower reads fallen

Two rulings from Jamie, recorded in `docs/DECISIONS.md`.

**Duel King Tower.** Asked "Duel King Tower: show "Down" when the
opponent took three crowns?", Jamie answered "yes". In a duel round the
game omits `kingTowerHitPoints` (it does not send 0) for a side whose
opponent took three crowns in that round (`cr-agent-api-docs`,
`models/battles.md`, Duel Rounds: all 108 such rounds of a sample).
Ingest stores the absence as null; the record and ingest are unchanged.

The rule lives in one place, the battle page's projection
(`withFallenKing` in `services/web-api/src/battle-page.mjs`): for each
duel game, a side whose `tower_hp` has no `king` while the other side's
crowns in that game are 3 reads `king: 0` with `king_inferred: true`
beside it. The page (`apps/web/src/views/Battle.jsx`) and the picture
(`services/web-api/src/share-image.mjs`, also `/h/<id>.png`) already
draw a 0 as "destroyed" and "Down", so neither changed its reading; they
cannot disagree. The JSON at `/api/public/battles/<id>` keeps its shape:
`games[].sides[].tower_hp.king` is a number where it used to be absent,
and `king_inferred` is a new optional field. No reader distinguishes a
sent 0 from an inferred one today; the flag is there for one that
wants to. A side with no tower state at all, any other missing King,
the Princess Towers and every non-duel battle are untouched.

Readers checked: the game's winner (`roundWinner`) is read before the
inference, from the values as recorded, and a three-crown game is
decided by its crowns before any tiebreak; `scoreOf` reads winners only.
The page's "hitpoints left" sums a missing value as 0 already. Home's
session games and the timeline's evidence (`packages/tools/src/activity/
entries.mjs`) read round crowns, never a King value. MCP's
`battles_query` still serves a round's `tower_hp` without `king` for that
side, as recorded. Decided 2026-11-13: it stays as recorded and does not
say the King fell (Jamie agreed with that recommendation; DECISIONS, "A
duel game's left-out King Tower reads fallen").

The battle page's towers note says, under a duel game, that a King Tower
shows as destroyed when the other side took three crowns in that game;
`apps/site/src/docs/battles.md` says the same.

**Directory opt-out.** Asked "Directory opt-out: may leaders save a
policy without being listed?", Jamie answered "no". Saving a policy
lists the clan; there is no save-without-listing choice. The directory
and Clan policy docs already say so; the policy editor now says it
beside the save note: "Saving lists this clan in Elixir's clan
directory, with its policy's public part." Disclosure only; no toggle.

Tests: `services/web-api/test/battle-page.test.mjs` (a three-crown game
with the King missing reads fallen on the projection and the drawn
picture, a missing King under one crown stays missing, winners and score
unchanged; `withFallenKing` unit cases), `share-image.test.mjs` (Down
under three crowns, "—" under two), `apps/web/test/battle-duel-decks.test.jsx`
(destroyed tile and the note; "—" under fewer crowns).

What's new 238.
