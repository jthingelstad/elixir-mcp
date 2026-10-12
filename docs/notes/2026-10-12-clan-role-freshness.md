# 2026-10-12 — Elixir Clan: a leader's change needs a roster read within the hour

MCP and JSON API unchanged (nothing in `packages/contracts` moves). No
migration. Deployed with no acceptance family: nothing a tool serves
changed (Clan reads `clans_roster` as it is; the change is Clan's own
requests, engine and views).

## Why

Clan's role is the record's: the gate reads `clan_membership` through
`/api/v1/me` on every request, and that row moves only when the clan's
roster is read from the game (the ledger's cadence: 15 minutes to 4
hours for a recorded clan, 4 to 24 for one followed only through a
player). A leader kicked or demoted in the game kept every leader power
here until that read, hours for a quiet clan.

## What changed

`packages/clan/src/role-freshness.mjs`, called by the handler before any
route runs:

- **Leader mutations** are every request other than GET (and HEAD and
  OPTIONS) to `/api/clans/:tag/...` from a person whose role there is
  leader or co-leader, except three that do not need the leader band:
  `/me/away` (a member's own away notice), `POST /policy/preview` and
  `POST /scout` (reads sent as POST: a draft's comparison, an
  applicant's numbers; they change nothing of the clan's). A route
  added later is a leader mutation unless it is added to that list.
  Elders and members are not checked: their changes (a welcome
  decided, a comment, their own away) do not use leader powers, and
  the service checks their role as before.
- **Views are not**: a GET changes nothing, and someone who lost the
  role sees at most what the clan's record showed an hour ago, which is
  what any member of the clan could see a moment before. Holding every
  view on a roster read would put a live fetch behind ordinary browsing
  and spend the shared budget on reads.
- **The check:** a compact `clans_roster` read; its
  `meta.source_polls.clan.observed_at` (the clan's `poll_state`
  `last_admitted_at`) within `ROLE_CONFIRM_MAX_AGE_MS` passes. Older, or
  never: `clans_roster` with `live: true`, the ledger's existing live
  lane (`makeLive`: one open job per clan, charged one global token when
  minted, a second ask while it is open is the same ask and costs
  nothing; Clan is first-party, so no person's live quota). A read
  already inside the API's cache window passes at once. Otherwise the
  request is refused with `ManageError` 409 `role_unconfirmed`
  (`roster_observed_at`, `max_age_s`, `retry_after_s`). A clan nobody
  records answers the plain read `not_recorded`, and goes to the live
  ask the same way. `live_fetch` is not used: it is fetch-only and never
  moves `clan_membership`.
- **The person sees** "Confirming your role in the game; try again in a
  minute" above the page, with Try again and Dismiss
  (`clan-web/src/lib/role.js`, `components/RoleConfirming.jsx`). Try
  again re-sends the same request and its answer goes to the page that
  asked; Dismiss hands that page the refusal.
- When the live read lands, the next request reads a roster no more than
  minutes old; the gate then gives the role the game shows, so a kicked
  leader is refused by the gate (`membership_unknown`) and a demoted one
  by the service's own role check.

## Assumption

**60 minutes is an assumption** (Jamie chose it from the options on
2026-10-12): long enough that an active clan's scheduled roster reads
(every 15 to 60 minutes) almost never make a leader wait, short enough
that a kicked leader's window is an hour at most, not a quiet clan's
four to twenty-four. It is one constant, `ROLE_CONFIRM_MAX_AGE_MS`; a
different bound is that line.

## Tests

- `services/web-api/test/clan-role-freshness.test.mjs` (scratch
  Postgres, the real handler, tools and live lane, no collector): a
  stale roster refuses 409 and mints one live job, charged once; a second
  request while it is open mints nothing and is not charged; a read is
  not held; a fresh roster proceeds. A membership row the roster poll
  changed (demoted, then left) takes the role on the next request. An
  unrecorded clan asks the live lane too.
- `packages/clan/test/role-freshness.test.mjs`: which requests count,
  the compact and live calls, an already-fresh live answer, no read at
  all, elders and members never held, a failed read is
  `elixir_unavailable`.
- `packages/clan-web/test/role.test.jsx`: the notice, Try again until
  the role is confirmed, Dismiss, and that only the API's changes go
  through it.
- The fake door's roster (`packages/clan/test/fakes.mjs`) now reads as
  fresh unless a test names `rosterObservedAt`; `clan-session.test.mjs`
  seeds a fresh roster read for its leader's changes.
