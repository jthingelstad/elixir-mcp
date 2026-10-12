# 2026-10-12 — Collectors: open enrollment; the admission checks are the trust (#540)

MCP 11.11.2 and JSON API 3.2.0 unchanged: `elixir_collectors` keeps its
description and fields (`status`, `lifecycle` and the notes read the same
states). No migration. From the collectors brief Jamie ratified on
2026-10-12 (#525), `docs/product/collectors.md` "Who it serves", and the
DECISIONS line "Zero-trust collectors, open enrollment".

## Jamie's answer

DECISIONS, "Zero-trust collectors, open enrollment" [Jamie, 2026-09-06,
2026-10-12], from the brief:

> Anyone may run one: enrollment is raising a hand, the maintainer
> approves whoever does, and the admission checks (shape, identity,
> content-derived ids, quarantine) are the trust a hobby record needs;
> no shadow lane is built first.

## Product questions and the answers taken

1. **What does "quarantine" mean among the admission checks?**
   [engineering, 2026-10-12] The brief names "quarantine" among the
   admission checks, but no payload quarantine exists: admission is
   binary, probation data projects straight into canonical tables, and
   the only hold is the missed-streak drain. Default in force: drain plus
   revoke is enough; "no shadow lane is built first". No payload hold is
   built. The docs say what exists: ten expired leases in a row drain a
   collector, and the maintainer's revoke ends its token at once.
2. **What state does a raised hand land in?** [engineering, 2026-10-12]
   `probation`, the state the door already leases to, with its one-time
   token minted and staged for the operator's reveal in the same insert
   (72 hours, as before). Not `active`: the operator bonus reads
   `status = 'active'` (`packages/claims/src/pool.mjs`, the Admin account
   list), and #539's default makes `active` the ground for the Family
   tier, so a raise alone must earn nothing.
3. **What makes a collector `active`, now that no owner step does?**
   [engineering, 2026-10-12] Its first admitted submit. The door, after
   ingest answers `admitted`, moves a `probation` gateway to `active` in
   the update that already counts the submit
   (`packages/collector-door/src/door.mjs`, submit). A rejected payload
   or a fetch error promotes nothing. A drained collector the maintainer
   puts back on probation returns to `active` the same way.
4. **What if the staged token lapses unclaimed, or is lost?**
   [engineering, 2026-10-12] The operator stages a fresh one on their
   collector's own page (`POST /api/me/gateway-token`, signed in, own
   collector, not revoked). It replaces the token the machine holds, so
   the page says so. The maintainer's "Stage a token" stays.
5. **What stays the maintainer's?** Revoke (instant, at the door) and
   drain, both in Admin ▸ Collectors, which still lists every enrolled
   collector with its operator, state and heartbeat. The raise still
   emails the maintainer; the note now says the collector is approved
   and where to revoke it.
6. **What about a raise that never runs?** Unchanged rule: a `probation`
   collector that has not checked in for an hour reads `silent`
   (`packages/ingest/src/fleet.mjs` counts from `enrolled_at` when there
   is no heartbeat), and the maintainer is told once. That is true of an
   abandoned raise, and it is the maintainer's cue to revoke if wanted.

## The admission checks, as the docs now name them

Read at 36068cb8.

- Shape validation and identity binding: `admit()` in
  `packages/ingest/src/admission.mjs:206-229`. Every payload must match
  its endpoint's shape; a player, clan or river race payload must be
  about the tag the job asked for; a battle log must have the requested
  player on the team of every battle.
- Content-derived battle ids: `packages/ingest/src/battles.mjs:225-230`.
  A battle's id is a hash of its time, its players' tags and its kind,
  so every observer's copy meets on one row.
- Server-stamped provenance: the door stamps `gateway_id` from the token
  (`door.mjs:600-604`); a collector cannot submit as another.
- Lease ownership: a submit settles only a job leased to that token
  (`door.mjs:554-562`).
- Per-token budget: 10,000 work and 120 config requests an hour
  (`door.mjs:60-86`).
- Lease cap: two unsubmitted leases per token (`door.mjs:365-376`).
- Missed-streak drain: ten expired leases in a row and the door stops
  leasing and drains the collector (`door.mjs:449-472`).
- Revoke: the maintainer's, a row update the door checks on every call.

The minimum version: `versionRefusal` (`door.mjs:236-240`) is off in
code and refuses lease and submit below `min_client_version` only when
`COLLECTOR_MIN_ENFORCE` is `1`. The analysis read it as off; the live
stack's `CollectorMinEnforce` parameter is `"1"` (DescribeStacks,
2026-10-12, as `projects-cloud-engineer`), a preserved parameter, so the
gate is on in production. The engineering doc says both; this change
does not touch it.

## What changed

- `POST /api/gateways` inserts `probation` with the token staged and
  answers `status: "probation"`, `provision_ready: true`.
- The door promotes `probation` to `active` on an admitted submit.
- `POST /api/me/gateway-token`: the operator stages a fresh token.
- Console: the raise form, the collector page (a "New token" panel for
  the operator), Admin's fleet note, and the sign-in footnote.
- Docs: `COLLECTOR-ZERO-TRUST.md` drops the activation gate and the
  shadow lane and states the admission stance; `operators.md`,
  `quickstart.md`, `your-account.md`, the home page and the glossary say
  open enrollment; What's new #15.
- #421's shadow-lane half is superseded by #540; the issue stays open
  for its other items.
