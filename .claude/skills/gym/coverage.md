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
| badges | r6 fixed (7.2.6) — beta: ready after #337 (done) | 7.2.4 | 2026-09-24 | 6 | reports/2026-09-24-badges-r6.md | r6 pre-beta: 22/22 hold; #337 roster badge_count null unread, #338 newest profile stamp; #339 praise |
| battles | r6 fixed (7.2.2) — beta: close→ready | 7.2.1 | 2026-09-24 | 6 | reports/2026-09-24-battles-r6.md | r6 pre-beta: 121/124 pass; #315 tower shares over known (war battles carry no tower troop); #316 praise |
| cards | r6 fixed (7.2.5-7.2.6) — beta: mostly ready | 7.2.2 | 2026-09-24 | 6 | reports/2026-09-24-cards-r6.md | r6 pre-beta: 26/26 hold; #324 Archer Queen name (tower entry), #325 Evo/Hero prefixes, #326 notes; #327 praise |
| clans | r6 fixed (7.2.5) — beta: ready (war clans after #334) | 7.2.2 | 2026-09-24 | 6 | reports/2026-09-24-clans-r6.md | r6 pre-beta: 44 items hold; #333 pre_reset in delta, #334 stint note, #335 note cap; #336 praise |
| collections | r6 fixed (7.2.3) — beta: ready | 7.2.1 | 2026-09-24 | 6 | reports/2026-09-24-collections-r6.md | r6 pre-beta: 14/14 hold; #322 board freshness (synced_at; sync had stood down behind a lease, re-run); #323 praise |
| elixir | r7 fixed (7.2.4) — beta: mostly yes | 7.2.1 | 2026-09-24 | 7 | reports/2026-09-24-elixir-r7.md | r7 pre-beta: #317 paging loop (cap by observed), #318 crossing at to, #319 war day 1 null, #320 docs; #321 praise |
| game | **CLEAN r6 (7.2.1)** — beta: ready | 7.2.1 | 2026-09-24 | 6 | reports/2026-09-24-game-r6.md | r6 pre-beta: 14/14 hold on a live war day; #314 praise; events span note (7.2.2); 128.4/143.3 amended |
| players | r5 fixed (7.2.5) — beta: needed #328 (done) | 7.2.2 | 2026-09-24 | 5 | reports/2026-09-24-players-r5.md | r5 pre-beta: #328 capture note+field, #329 ended buckets, #330 defenses, #331 roll note; #332 praise |
| rankings | r5 fixed (7.2.6) — beta: gated on #342 recording fix (Jamie) | 7.2.4 | 2026-09-24 | 5 | reports/2026-09-24-rankings-r5.md | r5 pre-beta: 21/21 hold; #342 incomplete reset board (re-read; note; recording fix = Jamie's 10:00Z decision), #343/#344 our_clan; #345 season_id string (Jamie); #346/#347 praise |
| war | r5 fixed (7.2.6) — beta: ready | 7.2.4 | 2026-09-24 | 5 | reports/2026-09-24-war-r5.md | r5 pre-beta on live war day: 24/24 hold; #340 in-progress fame notes; #341 praise |
| journey | r1 (new user) and r2 (clan leader) fixed (7.1.6-7.1.7) | 7.1.4 / 7.1.6 | 2026-09-24 | 2 | reports/2026-09-24-journey-r1.md, -r2.md | r1: 5 of 10 first questions right first time; #256 min_players, #257 one-player rarity, #258-#259 member reads, #260 promote/kick route, #261 examples. r2: #263 boat defenses out of war days (standings rollup and after-close battles open, known), #264-#267 |

**2026-09-23 incident:** the sweep's afternoon load drained the db.t4g.micro's EBS byte balance to 0. The database is now db.t4g.small (Jamie). Deploy gates run per family (`--acceptance=<family>`).

**Round 2 complete (2026-09-23):** all ten families ran; none was clean, and every finding shipped (6.30.0 to 6.36.2). Round 3 is the last before a family is parked for Jamie (SKILL.md, "The sweep").

