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
| badges | findings fixed (6.20.0), round 2 due | 6.19.3 | 2026-09-23 | 1 | reports/2026-09-23-badges-r1.md | #91-#94 done; #18 confirmed |
| battles | findings fixed (6.21.0-6.21.1), round 2 due | 6.19.3 | 2026-09-23 | 1 | reports/2026-09-23-battles-r1.md | #95-#100 done, #101 praise; 30/34 regressions confirmed; 140 duels repaired |
| cards | findings fixed (6.22.0), round 2 due | 6.21.1 | 2026-09-23 | 1 | reports/2026-09-23-cards-r1.md | #102-#108 |
| clans | findings fixed (6.23.0-6.24.2), round 2 due | 6.21.1 | 2026-09-23 | 1 | reports/2026-09-23-clans-r1.md | #110-#112; 6.24.x participation cap outage |
| collections | findings fixed (6.24.0), round 2 due | 6.22.0 | 2026-09-23 | 1 | reports/2026-09-23-collections-r1.md | #114-#116 |
| elixir | findings fixed (6.25.0), round 2 due | 6.23.0 | 2026-09-23 | 1 | reports/2026-09-23-elixir-r1.md | #118-#123; every tool has an outputSchema |
| game | findings fixed (6.26.0), round 2 due | 6.25.0 | 2026-09-23 | 1 | reports/2026-09-23-game-r1.md | #125-#127 |
| players | findings fixed (6.27.0), round 2 due | 6.25.0 | 2026-09-23 | 1 | reports/2026-09-23-players-r1.md | #129-#134; 9 regressions confirmed |
| rankings | findings fixed (6.28.0), round 2 due | 6.26.0 | 2026-09-23 | 2 | reports/2026-09-23-rankings-r1.md | #136-#138, #139 praise; 5 regressions confirmed |
| war | findings fixed (6.29.0-6.29.1), round 2 due | 6.27.0 | 2026-09-23 | 4 | reports/2026-09-23-war-r1.md | #140-#142, #143 praise; #88 closed via #141; war-day paths unchecked (training day) |
