# Keep the Record True — 2026-09-12

## Finding

Preflight at 2026-09-12T10:33Z was clean and synchronized; the `record`
lease was held only to record this run. The public status reader was healthy:
latest fetch and admission were 47 seconds old, DLQ depth was zero, and five
collectors were active. It nevertheless reported **53 capture gaps in 3,750
eligible battlelog polls over 24 hours (1.41%)**. That is above the objective
guardrail of roughly 0.1%, so this is a real capture-truth watch, not a healthy
no-op. The status reader cannot identify the affected subjects.

## Evidence completed

- Direct read-only CR API probes at 2026-09-12T10:32Z returned King Thing
  (`#20JJJ2CCRU`) with `battleCount: 1927`, a 30-row log whose battle times are
  ISO-Z, and both distinct evolution-form fields and rarity-relative card
  levels. The current POAP KINGS river-race payload was `state: full`,
  `periodIndex: 5`, `periodType: warDay`, with the clan's `fame: 6811` distinct
  from current-day `periodPoints: 1900`. These agree with the current recorder
  projections and the standalone CR API reference; no API-doc patch is due.
- The policy clock is consistent with the calendar: period index 5 is the
  third war day of section 0 in the September season. The private `war_drift`
  reader could not be invoked; see blocker below.

## Blocker and next evidence

`AWS_PROFILE=jamie aws sts get-caller-identity` and every read-only invoke of
`elixir-mcp-migrate` failed with `ExpiredToken` at 2026-09-12T10:32Z. Per the
workflow, no runtime source was edited: deployment readiness is not present.
After Jamie renews the `jamie` AWS profile, the next Record run should invoke
`{capture_audit:{days:1}}`, `{capture_audit:{days:3}}`, and
`{ab_yield:{hours:72}}`, then compare each gapped subject's roster
`lastSeen`/admission evidence against the 2026-09-11 roster gate. If the gaps
were gated while roster evidence said idle, fix the gate at the scheduler with
a real-fixture regression, then deploy and perform the same readers as
read-only acceptance.

## Repair and deployed acceptance — 2026-09-12T22:41Z

AWS read and deployment access was renewed. Public status at 22:36Z was
healthy (DLQ 0, latest fetch/admission 211 seconds) but reported 88 gaps in
4,101 polls (2.15%). The private readers returned 87 / 4,084 for one day and
117 / 11,894 for three days; the last-hour stats had 7 gaps in 225 polls. A
current CR API sample retained the expected 30-entry log, compact UTC battle
timestamps, rarity-relative levels, evolution fields, and distinct river-race
fame versus period points. The policy-clock reader returned 80 anchors across
10 clans with a 7-minute median offset. No API-model drift was found.

The high-gap sample `#PQQPUR8UL` had a 30-entry gap admitted at 22:22:51Z and
the live roster later reported `lastSeen` 21:35:53Z, while 17 clan members were
seen in the following hour. This made roster `lastSeen` an unsafe negative
signal for a rotating battle log, even when the clan is active. Commit
`bd85c9b` stops that gate from suppressing `player_battlelog` while retaining
it for profiles, with a scheduler regression, recording docs, update copy and
the durable decision in `docs/NOTES.md`. `npm run verify` passed. It was pushed
and deployed; the scheduler Lambda is Active with lastModified
2026-09-12T22:40:27Z, the public update page is live, and the newest audited
gap remained 22:32:55Z (before deploy). Keep the capture rate as an active
24-hour and three-day watch; do not claim the trailing rate has recovered yet.
