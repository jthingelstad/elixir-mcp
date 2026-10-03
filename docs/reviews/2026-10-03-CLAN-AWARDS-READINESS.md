# Clan season awards readiness review

Basis: main `310b352f`, October 3, 2026. PR #242 contains message editing and
action-link fixes; it does not repair awards. Two read-only consistency reviewers
traced the pure engine, private service, UI, announcements and existing tests.
Private production observations remain outside this public repository. No live grant,
announcement, membership action, provider call or credential read was made.

## Baseline findings repaired locally

| Finding | Evidence | Required repair and test |
| --- | --- | --- |
| Missing interior or terminal weeks can qualify as a complete season. | `seasonsFrom` checks only first section zero; removing an interior section still produces a closed, complete season with grants due. | Require unique contiguous sections and observed terminal coverage; test missing interior, terminal and duplicate sections. |
| Unknown points, donations or previous rookie participation become zero. | `seasonPoints` skips nulls, `seasonDonations` sums known weeks, and `rookieFilter` defaults unknown prior points to zero. | Distinguish known nonmembership from absent recording; hold consequential rankings when required evidence is unknown. |
| A partial grant batch prevents remaining winners on retry. | Any existing season/award recipient suppresses the whole award while the service writes recipients separately. Three tied winners with only the first saved produce no remaining grants. | Persist a frozen plan and resume it, or write the complete batch atomically; test interruption and retry. |
| Closed displayed winners can contradict immutable grants. | Refreshed participation changes closed ranks; UI labels recomputed podium rows granted even without a matching receipt. | Display final rank, name and metric from grants and verify final shared standings use the same evidence. |
| A later manual pick is absent from the season announcement. | Only computed grants raise announcements; an existing season card prevents another build and manual grant/revoke does not refresh it. | Keep completed actions immutable, refresh pending copy safely and provide a separate reviewed announcement when required. |
| One message silently omits awards and winners. | A five-award fixture renders two awards followed by "and 3 more". | Provide complete bounded segments and test every award/recipient is represented before human copy and send. |
| Manual grant API permits open/future seasons, empty rationale and overwritten provenance. | UI offers a closed-season picker but service only checks numeric season and maximum note length. | Enforce the documented closure/rationale boundaries and idempotent repeat behavior in the service. |

War Champ has priority because a clan can use its final ranking to make a manual
Free Pass choice. Preserve that choice as a leaders' pick, with the clan's saved
description and previous-season receipt visible together. Missing historical
grant evidence needs a human check; it does not authorize an inferred recipient,
automatic exemption or retrospective grant.

## Acceptance and live checks

Exercise all configured kinds: season points, attendance, donations, rookies and
leaders' picks. Include open-to-observed-close transitions, early finishes,
unknowns, saved grant stability, retries, leader/co-leader/elder permissions,
manual confirmation and full announcement copy on wide and narrow screens.
The baseline tests did not cover these cases; the repair adds synthetic regressions for them.

The implementation now guards every listed defect with synthetic fixtures.
Full repository verification and six built desktop/mobile journeys passed, including weekly provisional copy.
Final read-only reviews closed the rookie eligibility and pending segment-number
findings; the focused engine/service/provider-stub tests pass. Weekly copy bounds,
cached retry and disabled-configuration recovery findings are also closed.
PR #243 shipped as `727cfccf`; GitHub validate passed all 77 browser cases.
The canonical deploy, smoke and public health/docs/version read-back passed
on October 3, observed complete at 18:51:34Z (1:51 PM CDT). Production account
checks and any explicitly reviewed historical reconciliation remain separate. This document is engineering acceptance,
not a production snapshot or certification that current-season evidence is final.

The private canonical membership reader uses the shared membership query and
admitted roster observations to prove recorded absence separately over the
observed race and the full donation game-day week. It never
backfills counters or imports legacy grants. Any unresolved history remains held;
manual awards retain the saved rule and a human decision.
