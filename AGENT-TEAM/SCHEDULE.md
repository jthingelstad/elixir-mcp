# Scheduled activities

<!-- Generated from automations.toml. -->
Generator: projects-sysadmin/scripts/render_automation_schedules.py
Do not edit this table by hand. Change the approved manifest and regenerate it.

All calendar times use **America/Chicago**. Starts may include app jitter.
Companion entries share the primary objective, checkout lease and automation memory.
Interval wakes may skip the objective; preserve their prompt date guards.
Event follow-ups are explicit starts. Due subtasks use completion receipts.

| Activity | Status | Schedule | Primary owner |
|---|---|---|---|
| Run Elixir MCP | ACTIVE | Daily at 00:40, 04:40, 08:40, 12:40, 16:40, 20:40 | `run-elixir-mcp` |
| Keep the Record True | ACTIVE | Daily at 05:30, 17:30 | `keep-the-record-true` |
| Close the Loop | ACTIVE | Daily at 06:45, 18:45; Friday evening synthesis once per Chicago ISO week; catch up if blocked | `close-the-loop` |
| Guard the Door | ACTIVE | Daily at 02:15; Full weekly sweep on Sunday; retain required boundary checks every run | `guard-the-door` |
| Keep the Boards | ACTIVE | Daily at 05:20 (after the 10:00Z daily board lands; was 04:20 until 2026-09-12) | `keep-the-boards` |
