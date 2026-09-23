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
| badges | r2 findings fixed (6.30.0-6.30.1), round 3 due | 6.29.1 | 2026-09-23 | 2 | reports/2026-09-23-badges-r2.md | #144-#146 done, #147 praise; #145 decided by Jamie: corpus = recorded players |
| battles | r2 findings fixed (6.31.0-6.31.1), round 3 due | 6.30.0 | 2026-09-23 | 2 | reports/2026-09-23-battles-r2.md | #148-#151 done (148.1/148.4 refuted: event outside meta by decision), #152 praise; 41 regressions checked; open: tower level from HP needs an HP table |
| cards | r2 findings fixed (6.32.0-6.32.1), round 3 due | 6.31.1 | 2026-09-23 | 2 | reports/2026-09-23-cards-r2.md | #153-#155 done, #156 praise; 8/10 regressions confirmed; open: Mirror out of average_elixir unnoted; modeGroupSql vs modeGroupOf unknown-type default |
| clans | r2 findings fixed (6.33.0), round 3 due | 6.32.0 | 2026-09-23 | 2 | reports/2026-09-23-clans-r2.md | #157-#158 done, #159 praise; 13/13 regressions confirmed; donations = week high-water (Jamie); participation cap moot for Clan (now on /api/v1) |
| collections | r2 findings fixed (6.33.1), round 3 due | 6.33.0 | 2026-09-23 | 2 | reports/2026-09-23-collections-r2.md | #160 done (wording), #161 praise; #114/#116 confirmed, #115 remainder in #160; open: #116 selection caveat unmeasured |
| elixir | r2 findings fixed (6.34.0-6.34.2), round 3 due | 6.33.1 | 2026-09-23 | 2 | reports/2026-09-23-elixir-r2.md | #162-#167 done, #168 praise; timeline pages by observed_at and by size (40k chars); 164.3/122.1/168.4 refuted or superseded; elixir_my_players not exposed to the gym principal |
| game | r2 findings fixed (6.34.3, note only), round 3 due | 6.34.2 | 2026-09-23 | 2 | reports/2026-09-23-game-r2.md | #169 done, #170 praise; 7/7 regressions confirmed; 126.5 needs the first grid-pinned read (09-24) |
| players | findings fixed (6.27.0), round 2 due | 6.25.0 | 2026-09-23 | 1 | reports/2026-09-23-players-r1.md | #129-#134; 9 regressions confirmed |
| rankings | findings fixed (6.28.0), round 2 due | 6.26.0 | 2026-09-23 | 2 | reports/2026-09-23-rankings-r1.md | #136-#138, #139 praise; 5 regressions confirmed |
| war | findings fixed (6.29.0-6.29.1), round 2 due | 6.27.0 | 2026-09-23 | 4 | reports/2026-09-23-war-r1.md | #140-#142, #143 praise; #88 closed via #141; war-day paths unchecked (training day) |

**2026-09-23 incident:** the sweep's afternoon load drained the db.t4g.micro's EBS byte balance to 0. The database is now db.t4g.small (Jamie). Deploy gates run per family (`--acceptance=<family>`).

