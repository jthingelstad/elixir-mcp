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
| badges | r4 fixed (6.36.8); not clean (1 finding). Round 5 only if Jamie asks | 6.36.7 | 2026-09-23 | 4 | reports/2026-09-23-badges-r4.md | r4: 10/10 regressions confirmed (#183 as decided); #193 done (cut pages), #194 praise. Open: timeline badge level-ups incomplete (Ak, Mega Goblin; elixir family); a clan collection as segment answers not_found |
| battles | r4 fixed (6.36.10); not clean (1 finding). Round 5 only if Jamie asks | 6.36.8 | 2026-09-23 | 4 | reports/2026-09-23-battles-r4.md | r4: 50 regressions confirmed, 3 retired (battles_levels gone); #199 done (seasonal Trophy Road past 14,000 counted as trophy battles), #200 praise; mode description lists event |
| cards | r3 fixed (6.36.6); **round 4 due** (Jamie) | 6.36.5 | 2026-09-23 | 3 | reports/2026-09-23-cards-r3.md | r3: 13/13 regressions confirmed; #191 done (tournament unbanded, bands repaired 09 + 08), #192 praise. Open: season partner counts run to now vs the anchor at the cursor (~0.3%); raw season corpus reads near 18 s; Mirror out of average_elixir; level_played is an undocumented mean |
| clans | r3 fixed (6.36.9); not clean; **PARKED after 3 rounds** (every finding shipped) | 6.36.7 | 2026-09-23 | 3 | reports/2026-09-23-clans-r3.md | r3: 16 regressions; #158 partial -> #195 (clan pre_reset high-water, 0161), #196 capture-gap note, #197 leavers out of profile aggregates, #198 praise; 159.1 known (weeks 8 over cap). Open (elixir family): elixir_timeline clan week sums today's members; elixir_changelog current 6.21.1 |
| collections | r2 findings fixed (6.33.1), round 3 due | 6.33.0 | 2026-09-23 | 2 | reports/2026-09-23-collections-r2.md | #160 done (wording), #161 praise; #114/#116 confirmed, #115 remainder in #160; open: #116 selection caveat unmeasured |
| elixir | r2 findings fixed (6.34.0-6.34.2), round 3 due | 6.33.1 | 2026-09-23 | 2 | reports/2026-09-23-elixir-r2.md | #162-#167 done, #168 praise; timeline pages by observed_at and by size (40k chars); 164.3/122.1/168.4 refuted or superseded; elixir_my_players not exposed to the gym principal |
| game | r2 findings fixed (6.34.3, note only), round 3 due | 6.34.2 | 2026-09-23 | 2 | reports/2026-09-23-game-r2.md | #169 done, #170 praise; 7/7 regressions confirmed; 126.5 needs the first grid-pinned read (09-24) |
| players | r2 findings fixed (6.35.0), round 3 due | 6.34.3 | 2026-09-23 | 2 | reports/2026-09-23-players-r2.md | #171-#172 done, #173 praise; 14/16 regressions confirmed; #172 unify-the-ranges held for Jamie; open: donations high-water vs lifetime (414 vs 386) |
| rankings | r2 findings fixed (6.36.0), round 3 due | 6.35.0 | 2026-09-23 | 3 | reports/2026-09-23-rankings-r2.md | #174-#177 done, #178 praise; #136/#138 + legacy confirmed, #137 remainder = #174 |
| war | r2 findings fixed (6.36.1-6.36.2), round 3 due | 6.36.0 | 2026-09-23 | 5 | reports/2026-09-23-war-r2.md | #179-#181 done, #182 praise; 15/16 regressions confirmed; war-day paths untested (training day); fame-by-placement also in cr-agent-api-docs |

**2026-09-23 incident:** the sweep's afternoon load drained the db.t4g.micro's EBS byte balance to 0. The database is now db.t4g.small (Jamie). Deploy gates run per family (`--acceptance=<family>`).

**Round 2 complete (2026-09-23):** all ten families ran; none was clean, and every finding shipped (6.30.0 to 6.36.2). Round 3 is the last before a family is parked for Jamie (SKILL.md, "The sweep").

