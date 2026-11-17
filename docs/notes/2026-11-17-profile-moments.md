# 2026-11-17: Profile moments

The owner, 2026-11-17: "I feel like elixir has more info that would be
interesting in the timeline and is already collecting." Elixir already
reads every recorded player's profile, and most of what changes between
two reads was never told. This change tells seven more things, from data
the record already holds or now keeps, and draws the small ones as
compact rows. MCP 13.5.0; the JSON API is unchanged at 5.1.0.

## What is told

| Moment | Sentence | When (`at`) | How late |
| --- | --- | --- | --- |
| Badge rung (`badge_earned/3`) | "Pip took Hog Rider Mastery to level 5." / "Pip reached Mastery level 10 with 1 card and level 5 with 3 cards." / "Pip took 2v2 to level 2." | the profile read that saw the latest level the story holds | one profile poll |
| Years played (`badge_earned`, `YearsPlayed`) | "Pip has played Clash Royale for 3 years." | the read that saw the new level | one profile poll |
| 12-win run (`twelve_win_run/1`) | "Pip won 12 in Grand Challenge." ("... 2 times." when the count rose by more) | the read that saw the count rise | one profile poll |
| Card maxed (`card_maxed/1`) | "Pip maxed Hog Rider." | the read that saw the card at its top level | one profile poll |
| King Tower (`king_tower_leveled/1`) | "Pip reached King Tower level 15." | the read that saw the level | one profile poll |
| Best challenge run (`challenge_best_run/1`) | "Pip's best challenge run is now 9 wins." | the read that saw the new best | one profile poll |
| Session facts (`battle_session/5`, `session_standout/6`) | "...; 2 three-crown wins, 1 overtime win" in the sentence, and chips on the card | the sitting, as before | as the sitting |

A profile poll is once a day, every 8 hours for a player somebody follows
directly (`/docs/freshness-and-gaps`). None of these is proved by a
battle, so `at` is the read, never a guess at the battle.

## The rules

- **Badge rungs.** A Mastery badge is told when a level-up crosses a
  multiple of 5 or reaches its top level: 3 to 6 crosses 5 and is told
  with the game's level, 6. Any other tiered badge tells every level,
  its first included. Battle Wins and Collection Level are never told:
  each has its own step moment. Ingest writes the rung in `step` (0286);
  rows from before keep the old rule, so nothing old resurfaces.
- **One story a day.** The timeline groups a player's badge rows by UTC
  day: a badge seen twice is its latest level (the story keeps the
  earliest prior level), and all Mastery rungs are one story, with
  `badges[]` (highest first, ten at most) and `badge_count`. The story id
  is the day's first row, its revision the row count, so a later read
  that adds a rung edits the same story on Discord and the feed.
- **12-win runs.** A 12-win badge's `progress` counts the player's 12-win
  runs in that challenge, so a rise is a run. This is inferred, not
  verified: the reference's examples fit it (Classic12Wins at level 1
  with progress 2 and target 10), and a live read of a 12-win run is
  still owed. The tier itself is no longer told as a badge.
- **Session facts.** A three-crown win is a win with three crowns, not in
  Duel or Boat Battle (their crowns count differently). An overtime win
  is a head-to-head win the tiebreaker decided (`durationOf` basis
  `overtime_expired`); a win by a tower falling in overtime is not
  provable from the log and is not said. Both are present only when at
  least one.

## Silent first comparison

Every new kind is a change between two reads. The first read of a
player writes nothing; King Tower and best run need a number on the
previous snapshot, and snapshots from before 0286 hold null, so the first
read after deploy only sets the baseline; a card first seen maxed writes
nothing; a 12-win badge needs an earlier read of the profile. Tests:
`packages/ingest/test/profile-moments.test.mjs`.

After deploy, the first profile poll of each player (up to a day) writes
only baselines for King Tower and best run. Badge rungs and maxed cards
begin with the first level-up after the deploy. Expect a few moments in
the first hours, rising to a steady trickle after the first day.

## Where each goes

All new kinds reach the feed, MCP, RSS and the person's Discord
cross-post, and the clan Discord milestones. The friends digest leads
with King Tower, best run and 12-win runs and counts maxed cards and
badges. None is a push or a headline; the bell carries no moments.

## In the app

A badge, years played, maxed card, King Tower, best run or 12-win
moment (not a close friend's, not a clan item, no comments) is a small
moment: one line with its card art or a mark. Two or more in a row fold
into one row, "4 moments from Pip, Ash and 2 others", that opens in
place, as short sessions do; each keeps its own cheer. A Mastery roll-up
shows up to four of its cards, whole (`moment_cards`).

## Product calls left open

- King Tower as a headline or a push.
- Small moments fold a friend's item that is not close; a close friend's
  keep the card.
- Badge art: decided by the owner the same day, as its own change.
