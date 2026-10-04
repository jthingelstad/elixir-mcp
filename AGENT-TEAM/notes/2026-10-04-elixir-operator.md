# 2026-10-04 — Elixir Operator

## Evidence

- Preflight: observation available, this worktree mutation-eligible, and no
  deploy lease holder. Public status at 09:48Z was healthy: 27-second
  fetch/admission freshness, 10 battles in the last hour, no capture gaps,
  dead letters, or ledger backlog. Five signed v3.0.6 collectors were active.
- Read-only `{stats}` found zero hourly battle-log gaps and zero hourly fetch
  errors. The only 24-hour errors were two current-river-race 404s; the
  ledger was empty and no job was held or dead. All Elixir alarms were OK.
- The 05:20Z efficiency and 05:30Z activity jobs completed. The activity job
  wrote zero archetype re-stamps. The enabled Clan runtime has one policy
  clan, whose latest morning receipt completed on its first attempt.
- The preview's three containers have been up since October 3. Their natural
  update/editor activity continues, but two secondary instances cannot resolve
  their configured ask channel. The host logs identify an access/binding fault
  at boot, not a hub or contract failure.

## Decision and next check

Queued a `run` note for Jamie: repair each affected preview bot's ask-channel
binding or permissions, restart only the affected container, and verify the
next natural ask turn. Do not restart healthy instances or create test traffic.

One 25.2-second Clan draft 502 occurred at 19:15Z on October 3 and did not
repeat in the following 24-hour door census. Retain it as a capacity watch;
diagnose at the source only on repeated natural evidence. The acceptance suite
was not replayed because the prior red receipt remains untriaged.
