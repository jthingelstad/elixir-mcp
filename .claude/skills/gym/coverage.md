# Gym coverage

One row per MCP family. **Clean** means a Gym run filed no new findings and
confirmed every regression it checked, on the contract version shown, and
no later deploy has touched the family. Only the orchestrator edits this
file (`SKILL.md`, "The sweep").

Before the Gym moved into the repo (as of 2026-09-23), the cloud Gym had
explored only `rankings` (6.1.0, 09-19/20) and `war` (6.10.0–6.19.0,
09-21/22/23). Neither run was a clean pass: both filed findings, now
shipped, and both need a regression pass.

| Family | Status | Contract | Date | Rounds | Report | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| badges | r5 fixed (7.1.9); not clean (1 finding) | 7.1.7 | 2026-09-24 | 5 | reports/2026-09-24-badges-r5.md | r5: #279 unread population says unknown, holder observed_at = newest profile read; #280 praise |
| battles | r5 fixed (7.1.13); not clean (1 finding) | 7.1.12 | 2026-09-24 | 5 | reports/2026-09-24-battles-r5.md | r5: 109/112 cases pass (148.1/148.4 refuted, 263.3 known); #300 clan segment is today's membership (note); #301 praise. Open: before_after mode split, battles_decks default-limit refusal, applied.verbosity on one-size tools |
| cards | r5 fixed (7.1.10); not clean (4 findings) | 7.1.8 | 2026-09-24 | 5 | reports/2026-09-24-cards-r5.md | r5: #281 first_played per form, #282 tower troops refused by name, #283 held observed_at, #284 shrinkage note population-wide; #285 praise. Open (Jamie): a tower-troop interface |
| clans | r5 fixed (7.1.18); not clean (2 findings) | 7.1.16 | 2026-09-24 | 5 | reports/2026-09-24-clans-r5.md | r5: 27 regressions, #263 partial (known grid residue); #305 weekly counter delta across resets, #306 training rebuild at the race's own roll (backfill re-run, stale rows removed); #307 praise. Open: Gem in #242 note, clan_ladder season_id string, shared joined_observed_at on 3 leavers |
| collections | r5 fixed (7.1.19); not clean (1 friction) | 7.1.18 | 2026-09-24 | 5 | reports/2026-09-24-collections-r5.md | r5: 14/14 regressions hold (#286 exact: 2,292 decided); #308 coverage note wording ('not recorded now'); #309 praise |
| elixir | r6 fixed (7.1.16); not clean (2 findings) | 7.1.12 | 2026-09-24 | 6 | reports/2026-09-24-elixir-r6.md | r6: 7/9 hold, #270 partial -> #302 (recurring sitting note, conditional), #303 +N on every summary list; #304 praise; 265.2/270.2 retired |
| game | r4 fixed (7.1.12); not clean (3 findings) | 7.1.10 | 2026-09-24 | 4 | reports/2026-09-24-game-r4.md | r4: 11/11 regressions hold; #296 read-outside-window note, #297 season, #298 is_colosseum/weeks_in_season/colosseum_starts_at; #299 praise. 126.5 still waits on the first grid-pinned read after 10:00Z |
| players | r4 fixed (7.1.8); not clean | 7.1.7 | 2026-09-24 | 4 | reports/2026-09-24-players-r4.md | r4: #275 season_trophies labelled, #276 side-mode progress on the profile, #277 pre_reset lower bound everywhere; #278 praise |
| rankings | r4 fixed (7.1.11-7.1.12); not clean (5 findings) | 7.1.9 | 2026-09-24 | 4 | reports/2026-09-24-rankings-r4.md | r4: 15/16 held; #290 departures note, #291 clan zero, #292 inverted refused, #293 recorded locations listed, #294 our_clan + floor_score + roster clan_score (7.1.12); #295 praise. Changelog lead refuted (call made while 6.35.0 was live) |
| war | r3 fixed (7.1.2-7.1.3); not clean; **PARKED after 3 rounds** (every finding shipped) | 7.1.0 | 2026-09-24 | 3 | reports/2026-09-24-war-r3.md | r3: #223 banked fame (0164), #224 going-in trophies (0165), #225 deprecation/docs, #226 rival points (new fields), #227 praise; war-day paths untested (training day) |
| journey | r1 (new user) and r2 (clan leader) fixed (7.1.6-7.1.7) | 7.1.4 / 7.1.6 | 2026-09-24 | 2 | reports/2026-09-24-journey-r1.md, -r2.md | r1: 5 of 10 first questions right first time; #256 min_players, #257 one-player rarity, #258-#259 member reads, #260 promote/kick route, #261 examples. r2: #263 boat defenses out of war days (standings rollup and after-close battles open, known), #264-#267 |

**2026-09-23 incident:** the sweep's afternoon load drained the db.t4g.micro's EBS byte balance to 0. The database is now db.t4g.small (Jamie). Deploy gates run per family (`--acceptance=<family>`).

**Round 2 complete (2026-09-23):** all ten families ran; none was clean, and every finding shipped (6.30.0 to 6.36.2). Round 3 is the last before a family is parked for Jamie (SKILL.md, "The sweep").

