# 2026-11-16 — Other play modes in the timeline

Jamie, 2026-11-16: "I don't play path of legends, I'm not a ranked
player, but I feel like we are missing a lot of function there ... do
your own research about how we could show activity from other play modes
more meaningfully." This note is the research and what was built from
it. MCP 13.4.0, migration 0279.

## What players play

Read-only, from the battle-log payload archive in S3 (no database load):
every battle the record captured from 2026-10-17 to 2026-11-16, 177
recorded players of whom 76 played. 17,928 player-battles in 4,204
sittings (30-minute gap); 15.1% of sittings mix modes.

| Mode group | Battles | Share | Sittings holding it |
|---|---|---|---|
| Ranked | 4,962 | 27.7% | 25.8% |
| Event content (challenges, CHAOS, 2v2, Duel, Global Tournament) | 4,714 | 26.3% | 27.6% |
| Trophy Road | 4,204 | 23.4% | 30.8% |
| Seasonal Trophy Road (event content, Ladder ruleset) | 1,817 | 10.1% | 13.8% |
| Casual (friendly, clanmate) | 1,140 | 6.4% | 7.4% |
| War | 1,086 | 6.1% | 11.7% |
| Tournament | 5 | 0% | |

Ranked is the largest single mode, and the timeline told it as "N Path of
Legends" plus a `trophy_net_by_mode.ranked` that summed +30 a win. Ranked
battles by the league they started in: Master I 15.6%, Master II 14.7%,
Master III 12.7%, Champion 22.9%, Grand Champion 13.9%, Royal Champion
10.1%, Ultimate Champion 10.1%. Of 1,086 Ranked sittings, 34 (3.1%)
climbed a league inside the sitting and 53 were in Ultimate Champion.

War: river race 1v1 73.4%, boat battles 11.7%, duels 11.6%, Colosseum
3.3%. Social: 924 2v2 battles, where the teammate was a recorded player
in 28.8% (13 distinct pairs); 1,139 friendly or clanmate battles, where
the opponent was recorded in 72.5%.

Events, by title: the Classic, Grand and 20-win challenges (1,711
battles), Classic 1v1 (993), Classic 2v2 (810), C.H.A.O.S Blackout (325),
C.H.A.O.S Draft (317), Duel (188), Power Surge Global Tournament (140),
C.H.A.O.S Power Surge (130), a Spooky Chess league with its own standing
(54), C.H.A.O.S Mega Draft (35). One title arrived with a newline in it.

Community sources (Fandom's Ranked, 2v2, Clan Wars, Special Event
Challenges and Friendly Battle pages, through its MediaWiki API) agree
with the reference: Ranked has seven leagues, steps below Ultimate
Champion that the API does not expose, a rating in Ultimate Champion, a
monthly reset; challenges end at a loss limit with a win counter;
friendlies and 2v2 carry no trophies. RoyaleAPI was not read.

## Mode by mode

Certain: the record holds it for every battle. Caveat: derivable, with
the limit said. Not knowable: the API does not carry it.

**Ranked.** What matters: the league, a climb, the rating at the top.
Certain: the league each battle started in (`leagueNumber`), a win or
loss, Ultimate Champion's rating and change. Caveat: a climb inside a
sitting, as the last win at the lower league before a battle stamped
higher (a rise after a loss means a battle is missing, so it is not
told); a climb on the sitting's last battle is the profile's
`ranked_promotion` item, not the sitting's. Not knowable: steps and
golden steps below Ultimate Champion, the step multiplier. Before: "9
Path of Legends" and a +270 "net". Now: "9 Ranked; climbed Master III to
Champion" or "Ultimate Champion, rating 1,850 to 1,940", and no net below
Ultimate Champion.

**Season end.** Not built. The record keeps the profile's Ranked league
each day, but last season's finish is not a column of its own, and an
unrated best can be on the scale before the July 2025 change. An item
needs that fact recorded first.

**Challenges and events.** What matters: which event, the record, how far
the run got, the rules. Certain: the title, the game mode, the deck
selection, wins and losses. Caveat: the run counter (`startingTrophies`
is the wins so far, absent at 0; `trophyChange` +1 a win, nothing on a
loss) gives the furthest the counter reached in the sitting; an event
whose battles move anything else (the Spooky Chess league, the seasonal
Trophy Road) has no counter. Not knowable: the loss limit (only the
event's free-text description says it), rewards. Before: "in Classic
Challenge (6)" and a drafted deck's archetype. Now: "in Classic Challenge
(5W-1L, up to 5 wins), C.H.A.O.S Draft (1W-0L, drafted decks)", one line
always.

**2v2 and friendlies.** What matters: who you played with or against.
Certain: every participant's tag. Caveat: named only when the record
follows them (an active player recording or a current member of a
followed clan), so a stranger is never named and no new way to find a
person appears. Before: `session_standout` alone named a 2v2 teammate.
Now: every sitting carries `together`. Left: two followed players' copies
of one 2v2 sitting are still two items (each names the other); one item
needs a pair story id and a rule for cheers (the timeline brief's Open).

**War.** Duels, boats and Colosseum are known per battle. "All four decks
done today" was not built: DECISIONS (Jamie, 2026-09-25) keeps war facts
weekly because the record cannot place a member's day reliably.

**Merge Tactics** is not in the battle log at all.

## What changed

- `sessionsOf` (`packages/tools/src/activity/entries.mjs`) builds
  `ranked`, `together` (named in `nameSessions` by one read of recorded
  players), each event's record, game mode, `drawn_decks` and `run_wins`,
  and leaves a drawn deck (draft, draftCompetitive, pick, predefined,
  unknown) out of `decks`. Event titles are cleaned to one line.
- `trophy_net_by_mode.ranked` sums only rated (Ultimate Champion)
  changes. A correction, not a shape change: `battles_performance`'s
  `net_trophies` is unchanged, so the two now differ below Ultimate
  Champion.
- Both battle reads select `league_number`, `deck_selection`,
  `starting_trophies` and the other participants' tags; the opposing
  crowns and the tags come from one lateral by key. Migration 0279 adds
  the two battle columns to `battle_timeline_cover` so neither read goes
  back to the battle heap.
- Schemas: `battle_session/4`, `session_standout/5`, with `ranked` and
  `together` optional.
- "Ranked" replaces "Path of Legends" in what players read (sentences,
  Home's mode words, Stats, Clan pages, the battle page and share image,
  the public docs, and Clan's policy, week and removal-evidence labels).
  Field and column names are unchanged; the Clan model's dossier keeps
  its wording (a local label map in `clan-engine/src/context.mjs`) for
  its own change. A removal action saved before the deploy keeps the
  words it was saved with.

## What a deploy does to history

Nothing is backfilled or rewritten. Home's stored week is rebuilt from
the record, so within three hours of the deploy (or at the next wake)
the last seven days' sittings carry the new facts and sentences under
their same story ids; nothing is narrated again. Discord posts already
made are not posted again. Migration 0279 rebuilds
one index on battle under a SHARE lock (seconds, as 0249 did).
