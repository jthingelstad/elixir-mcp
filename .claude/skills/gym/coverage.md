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
| badges | not run | | | 0 | | |
| battles | not run | | | 0 | | |
| cards | not run | | | 0 | | |
| clans | not run | | | 0 | | |
| collections | not run | | | 0 | | |
| elixir | not run | | | 0 | | |
| game | not run | | | 0 | | |
| players | not run | | | 0 | | |
| rankings | findings shipped, not re-run | 6.2.0 | 2026-09-20 | 1 | cloud | #71–#76 |
| war | findings shipped, not re-run | 6.19.1 | 2026-09-23 | 3 | cloud | #81–#89 |
