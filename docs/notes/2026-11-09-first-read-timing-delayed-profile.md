# 2026-11-09 — A delayed profile is not a second first read

`first_read_landed` (#731) took a profile with both diff baselines empty
as the player's first. A profile delayed behind a newer one on the first
recorded day finds neither baseline (the earlier-day row does not exist,
and the newer one is stamped after it), so it logged a second, later
landing and would have inflated the percentiles. `firstProfile` in
`packages/ingest/src/snapshots.mjs` now also asks whether the record holds
any profile observation of the player, one lookup on the snapshot key's
`player_tag` prefix made only when both baselines are empty (a first
profile, or that delay). Found by the Codex review of #731.

No migration, no contract change, nothing a user sees.
