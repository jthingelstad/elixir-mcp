# 2026-10-02 — Elixir Operator

## Pipeline receipt and acceptance-capacity watch

- **Preflight:** observation available, mutation eligible, deploy lease free;
  the worktree was detached at `5594a0ff` before this note branch.
- **Pipeline:** at 09:48Z public status was green: 1,090 battles/hour,
  four-second fetch and admission freshness, no queued/leased/dead ledger jobs
  or outbox DLQs, five fresh signed v3.0.6 collectors, and 16 capture gaps in
  21,035 polls. `{stats:true}` recorded zero trailing-hour filter gaps and no
  current fetch errors. All application alarms were quiet.
- **Scheduled work:** the latest hourly meta rollup completed in 4,785 ms with
  2,224 battles and no unresolved war rows. The installed Docker client was
  unavailable, so it could not provide preview-container evidence; no preview
  service was restarted or prompted. The active collector launchd jobs remain
  running, while the public status is the fleet source of truth.
- **Capacity triage:** do not rerun the queued 2026-10-01 acceptance failure
  (24 failures / 1,189 cases) until its receipt is resolved. The one-day
  audit has 1,870 acceptance calls and 83 adversarial/refusal outcomes; normal
  pipeline traffic is healthy. `battles_meta_cards` p95 is 17.7 s (two
  timeouts), `cards_card` p95 14.9 s, and `badges_rarity` p95 6.0 s.
  Read-only `profile_tool` traces show full scans and card/deck joins, but no
  demonstrated small index or source change that preserves the served query.
  Keep this as a repeated-evidence watch; do not weaken the acceptance ceiling
  or deploy a speculative schema change.
