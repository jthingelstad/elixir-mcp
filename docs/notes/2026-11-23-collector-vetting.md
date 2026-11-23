# 2026-11-23 — The owner vets every collector operator

Jamie, 2026-11-23: only he runs collectors now, nobody should be able to
create a working collector credential on their own, and "ultimately I
have to vet each person that ever runs a collector". This supersedes
open enrollment (2026-10-12, #540), under which any signed-in account's
raise was approved at once on `probation` with a working token.

Why it matters: an admitted payload goes straight into the record, and a
player-verification proof is any recorded battle with the target deck,
so an unvetted collector could forge someone's verification.

## What changed

- **The raise** (`POST /api/gateways`): a member's raise is inserted as
  `pending`, with its token staged for the one-time reveal as before, so
  the machine can be set up while it waits. The answer says "Request
  sent" and that the collector starts working once it is approved;
  nothing says "Approved". The owner's own raise is unchanged: it starts
  on `probation`.
- **One unproven collector** now counts `pending` too, so a second ask
  while one waits is refused (409 `unproven_collector`, worded for the
  wait).
- **The door** already refused `pending` on lease and submit (only
  config answers it, for `collector doctor`); no door code changed. The
  door test now pins both against a live lease another collector holds,
  with ingest never called, and then the approval letting it lease.
- **The owner's notice** (`gateway_request`) asks for a decision
  ("waiting for your decision. Approve it to let it fetch, or revoke
  it") and links the collector's own page, where the Operations panel
  now reads **Approve** (pending → probation) and **Turn down** (revoke,
  behind a confirm; **Revoke** on any other live state). The relay's
  subject is "Elixir: collector request". The owner's own raise still
  sends a notice, worded as enrolled on probation.
- **The operator's pages**: the collector's chip reads "Waiting for
  approval", a callout says what that means and that nothing more is
  needed from them, and the Settings list shows "waiting for approval".
  The raise page's footnote says it sends a request.
- **Docs**: `COLLECTOR-ZERO-TRUST.md` (trust posture, lifecycle,
  enrollment), the public operators page, glossary and roles,
  `OPERATIONS.md`, DECISIONS, and a What's new entry.

- **Public lists**: a request waiting for approval is not part of the
  fleet. `readPublicStatus` (the Status page and `/api/public/status`)
  and MCP `elixir_collectors` now leave `pending` out, so nothing public
  credits an operator the owner has not said yes to. The operator and
  the owner still see it on their own pages.

No migration: `pending` has been a gateway state since 0001.

## Not done

- **Tying a verification proof to the collector that observed it.**
  Vetting closes who may submit; a proof is still any recorded battle
  with the target deck, whichever collector saw it.
- **The collector's own words.** `collector doctor` on a pending token
  reads config, exits 2 (`not_yet_active`) and says "installed, not yet
  promoted - the maintainer moves this collector to probation; nothing
  to fix here". That is correct; its wording predates approval and
  could say "waiting for approval" in a later collector release.

MCP: `elixir_collectors` no longer lists a collector waiting for
approval, and its note says each one is reviewed; no argument or field
changed. JSON API unchanged.
