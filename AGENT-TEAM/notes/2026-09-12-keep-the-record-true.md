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
