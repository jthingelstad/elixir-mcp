# 2026-11-14 — Passports and Stamps: earning, reconciliation and the bell

Build slices 3 (server side), 4 and the bell half of 5 of
[the build handoff](../plans/stamps-build.md) (#1015). Stamps are now
earned. Migration 0270. No MCP or JSON API change; no new mail, feed
item, account event, analytics event, scheduled job, SQS message or
Clash Royale API call.

## Hooks

Each hook runs after its write has committed, in the same request, and
never inside its transaction. A refused or failed write calls no hook,
so it earns nothing. `services/web-api/src/passport-hooks.mjs` wraps
every hook: whatever it throws is caught, written as one log line
(`{"at":"passport_hook_failed","hook":…,"error":<code>}`, with no
account, tag, place or words), and the action answers as it would have.

| Write | Where | What it settles |
| --- | --- | --- |
| Ownership verified (primary or alt) | `routes/verify.mjs`, after the commit | Player verified; rewinds Played Together |
| A picture chosen (non-null card) | `POST /api/me/avatar` | Looking Good; back to initials is no choice |
| A place saved on the clan map | `PUT /api/clan/me/place` (200 only) | the map step and On the Map |
| A player added, followed, or its relationship changed | `routes/account.mjs` | add/follow steps, Full Roster, Inner Circle, Mutual; rewinds Played Together; a follow also settles the followed player's verified owner (their Mutual) |
| Discord linked | `routes/discord.mjs`, both link paths | Linked |
| A digest choice: a cadence, the digest on or off, or every email off | `PUT /api/me/email` | the digest step, from the stored row |
| A cheer on someone else's item | `PUT /api/me/cheers` | a Cheerleader day |
| A highlight posted or edited with words | `POST`/`PUT /api/me/highlights` | a Storyteller battle |

A settle reads one snapshot and grants every setup Stamp it proves, so
any later settle of the same account, or its reconciliation, repairs a
setup hook that failed. A place save is repaired by the reconciliation
asking Clan's store a boolean (does any verified player of yours have a
place now). Storyteller is repaired from the account's own highlights.
Cheerleader is not repaired: whether an item was someone else's is the
feed at the tap; a day whose only cheers all failed their hook is lost
until another accepted cheer that day.

The default weekly digest is no row and never a choice; an explicit
weekly, daily or Off is. Stamps never turn mail on. "Not now" on the map
completes its step and never grants On the Map. All Set needs the six
steps with a verified primary; once stored it stays, as every dated
Stamp does when its proof is later revoked or the place removed.

## Routes

- `POST /api/me/passport/reconcile` (person, contract header, 120 an
  hour): the owner's bounded pass. Answers `GET /api/me/passport`'s body
  plus `granted: [{stamp_id, level, earned_at, earned_on}]` (only the
  levels this call inserted) and `more` (true: the bound stopped it;
  call again).
- `POST /api/me/passport/map` with `{"choice":"not_now"}` (person,
  contract header, 60 an hour): the same body, `more: false`. Any other
  body is 400.
- The passport row is made at a person's first use (sign-up, or the
  first sign-in to an account made for them) as well as lazily.

## Reconciliation

One call: Storyteller from the account's highlights with words (at most
60 read), then Played Together, then a settle. At most 40 facts are
offered across both ladders and at most 200 qualifying battles read.
Played Together reads `battle_participant` by each own verified player's
range (never `= any`), friendly and clanmate types only, in the trailing
30 days, by ingestion: `battle.cursor` above the account's
`played_cursor` (0270). The checkpoint moves only past battles recorded
at least five minutes ago and handled, so a late ingest commit is still
read; one recorded late (a quiet player polled again) is read once,
when it arrives. A follow, alt or verification rewinds the checkpoint,
since the battles behind it were judged without the new player. A
rewind also counts up `played_epoch` (0270), and a pass moves the
checkpoint only while the epoch is the one it read at its start: a
rewind landing mid-pass wins, so the next pass reads the window again
against the new players (PR #1020 review). Facts the stale pass
recorded stay; they were true. The
other side must be a followed player who is not the account's own; in
2v2 the followed player must be the teammate; a battle whose shape the
record cannot prove is left out. One local day counts once.

## The bell

A grant writes no event. `/api/me/bell` reads `account_stamp_earned`
for the last seven days, groups each pass (one instant per pass) to one
line at its highest level, skips backfilled (legacy) levels, and folds
the lines into Your account newest first. Item:
`{kind:"stamp_earned", stamp_id, name, level, levels, at, events:1,
players:0, clans:0, subjects:[], new}`. The row reads "New Stamp:
Cheerleader II" (a one-level Stamp has no numeral) and opens
`/home/passport?stamp=<stamp_id>`. The bell's built read is one
statement more (budget 35, stored 14).

## Tradeoffs

- Played Together's 30-day look-back: a friendly recorded more than 30
  days after it was played is not counted. A battle log holds 25
  battles, so this is not expected.
- Cheerleader is not reconciled (above).
- A hook adds a few statements to the write it follows; a failure costs
  a log line, not the action.
