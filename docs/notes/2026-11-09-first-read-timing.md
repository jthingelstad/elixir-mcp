# 2026-11-09 — How long a first read takes, measured

Home tells a person who adds their player that "the first read usually
lands within a few minutes". Nobody had the number. Two log lines now
measure it from natural traffic; the wording waits for them.

- **`first_read_landed`** (collector group), from
  `packages/ingest/src/first-read.mjs`, after the admission commits. It
  fires once for a tracked player's first admitted profile and once for
  their first battle log with battles in it. Ingest already knew both
  from reads it makes anyway: the profile projector's two baselines found
  no earlier profile observation (`firstProfile` in `snapshots.mjs`), and
  the battle log found no high-water mark and wrote one (`firstLog` in
  `battles.mjs`). Only then is there one query: the subject's active
  player recording (the unique partial index) and the job by its key. No
  active recording, nobody tracks the tag, nothing is logged. Fields:
  `endpoint`, `lane`, `seconds_from_tracked` (since the active
  recording's `created_at`, which the first account still tracking the
  player started), `seconds_from_minted`, `seconds_queued` (mint to
  lease). No tag, account or email. A failure is one
  `first_read_timing_failed` line, never a failed admission.
- **`first_read_requested`** (web-api and mcp groups), from
  `requestFirstRead` in `packages/tools/src/live.mjs`: the add's outcome
  by name (`minted`, `joined`, `no_token`, `first_reads_spent`, `fresh`,
  `read_today`, `failed_today`, `not_found_today`, `no_live_lane`,
  `no_account`, `error`), so a slow first read can be told from one that
  was never asked for on the live lane.

The Logs Insights queries are in the `ops` skill, "How long a first read
takes". `[engineering]`: "tracked since" is the recording's start rather
than a claim's `created_at`; the two agree for a first add, and `claim`
has no index on `player_tag`. An empty battle log writes no mark, so it is
not counted until battles arrive.

No migration, no contract change, nothing a user sees.
