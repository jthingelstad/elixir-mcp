# Elixir Operator — 2026-10-07

- 09:50Z: Preflight and the public status endpoint were green: 147-second
  fetch/admission freshness, 10 battles in the trailing hour, 1,073
  capture-audit polls with zero gaps, no dead jobs or outbox DLQ, five active
  signed v3.0.6 collectors and one draining collector. The global budget used
  1.8% of its daily bulk share.
- Read-only migrate evidence confirmed 2,121 capture-audit polls over two
  days with zero gaps; the last-hour filter had 46 polls, 1,421 edge-filtered
  entries and zero gaps. The two 24-hour `currentriverrace` 404s were the
  expected season-standby shape. All Elixir alarms were quiet.
- The 05:20Z efficiency job reported zero lost battles for October 4 through
  6. The 05:30Z activity job completed with `archetype_stamp.written: 0`.
  `ClanInternal=true`; the prior morning completed for all three policy clans,
  with two correctly reporting `too_few_members` and one normal completion.
- Daily live acceptance exposed Gym 91.3's fixed unrecorded player. The
  approved tracked-only correction on `1d2de5d5` intentionally removed that
  player's profile and badge row, making the historical live control invalid.
  Marked it refuted in `acceptance/gym.json`; the remaining holder controls
  still verify that `observed_at` is the latest profile poll. No production
  mutation or lease claim occurred.
