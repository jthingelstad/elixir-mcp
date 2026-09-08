# Keep the Record True — capture-audit subject census

Preflight at 2026-09-08T11:43Z was clean and synchronized. Public status was
healthy (last admission 195 seconds, 144 battles in the prior hour, zero DLQ
messages) but reported 10 capture gaps in 1,000 eligible battlelog polls over
24 hours. The aggregate reader intentionally does not identify the affected
subjects, making it insufficient to decide whether the scheduler cadence or
fleet capacity is at fault.

The new private migrate operation, `{capture_audit:{days?}}`, returns those
subjects only, their gap counts and timestamps, and the matching
`poll_state.player_battlelog` planning/admission evidence. It does not mutate
the record and does not change the existing first-poll exclusion or cadence
policy. The scratch-Postgres regression test covers a mixed gap/non-gap subject
and an all-clean subject. `npm run verify` passed before deployment.

Other read-only evidence: the 48-hour probe shows continuous intake; the
latest direct API reads returned King Thing at battleCount 1,913 with a
30-entry battlelog, and POAP KINGS in training period 1 with all five boats at
zero fame. The war-anchor census was 60 anchors across 10 clans (median
observed offset +3 minutes; offsets include polling latency), and current
payloads showed no new shape or enum requiring a cr-agent-api-docs correction.
