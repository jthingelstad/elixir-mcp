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
| Clan Operator | ACTIVE | Tuesday, Friday at 05:15 | `run-elixir-clan` |
| Clan Policy Auditor | ACTIVE | Third Saturday of each month at 17:00; Every clan with a policy judged by its own policy; grants confirmed for each season closed since the last run | `judge-fairly` |
| Clan Feedback Manager | ACTIVE | Daily at 07:40, 19:40; Friday evening synthesis once per Chicago ISO week; catch up if blocked | `elixir-clan-close-the-loop` |
| Clan Security Reviewer | ACTIVE | Third Sunday of each month at 13:00; Every run is the full sweep | `elixir-clan-guard-the-door` |
