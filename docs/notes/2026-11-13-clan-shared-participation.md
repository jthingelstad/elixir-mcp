# 2026-11-13 — A cold Awards shares the clan's evaluation; a member's activity reads one member

A follow-up to the signed-in page budgets
(`2026-11-13-battle-post-settings-clan-budgets.md`). Those budgets left
two Clan reads paying for the whole clan's participation themselves:

- Awards asked cold (its snapshot older than an evaluation's five
  minutes) read the clan's participation again, even when Standings,
  Manage or You here had just read the same eight weeks.
- A member's activity page read the whole clan's four-week
  participation (every member's weekly battles and donations, the
  former members' and the clan's coverage) for one member's row.

## How it was measured

As the budget notes: `signed-in-seed.mjs` at 52 weeks and 20 clans, each
read through the web API's own handler, each statement run again under
`EXPLAIN (ANALYZE, BUFFERS)`. `signed-in-budget.test.mjs` pins it at 26
weeks and 8 clans.

## Before and after

| Read | Statements | Shared buffers |
| --- | --- | --- |
| `/awards`, cold, after the clan's evaluation | 53 to 28 | 21,314 to 215 |
| `/manage?refresh=1` | 61 to 62 | 24,471 to 24,476 |
| `/members/<tag>/activity` | 68 to 50 | 12,261 to 1,826 |

An evaluated Manage (or Standings, You here, Actions) makes one more
statement: it keeps its participation read.

## What changed

- **A shared participation read.** The manage service's evaluation
  keeps the participation it read in the clan ledger
  (`participation#<clan>`): the body, without the reader's own meta
  (only `as_of` and `freshness_seconds`, which the engines read), and
  the instant the evaluation began. Everything else in the body is the
  clan's record, the same for every member who reads it, and the
  verdict snapshot already holds the facts drawn from it. The item is
  in the clan's index, so it goes with `deleteClan`, and each
  evaluation overwrites it.
- **A cold Awards judges from it** while it is younger than
  `EVALUATION_TTL_MS`, and is dated at that read, as if it had run then:
  its grants, the weeks it announces and its snapshot's age follow the
  record it judged, so the snapshot is never older than the read plus
  one TTL, as before. A refresh (`?refresh=1`), the morning run and a
  clan last seen below the minimum read the record again, as before.
  Manage does not judge from Awards' read: its evaluation dates
  decisions' outcomes and new Actions by its own clock.
- **A member's part of the participation.** `memberParticipation`
  (`packages/tools/src/tools/clans.mjs`) answers the fields the member
  drill-down reads from clans_participation: the window's weeks, the war
  weeks (with `finished_early`), the member's current stint, last battle
  in the clan and war decks and points, and the read's `as_of`. It runs
  the tool's own code for each (the weeks and war weeks are helpers the
  tool now calls too, the stint is `stintStarts`, the war rows the
  tool's `war_weeks` and `war_participation` statements, the join and
  last battle `MEMBER_SQL`, which is MEMBERS_SQL narrowed to the member)
  under the same entitlement. The web API wires it into `createMemberActivity`; without
  it the drill-down reads the tool as before.

## Proof

- `awards.test.mjs`: a cold Awards two minutes after Manage's
  evaluation reads no participation and answers deep-equal to an Awards
  that read the record itself at the instant of that read; past the TTL,
  or on refresh, it reads again.
- `signed-in-budget.test.mjs`: a cold Awards after an evaluated Manage
  makes none of the participation tool's statements, in 30 statements
  and 1,000 buffers; `memberParticipation` equals the tool's answer for
  every member of the clan and for a player in none of it (only the
  read's instant differs); the member drill-down in 52 statements and
  3,000 buffers (68 and 15,000 before).

Nothing a page shows, who can see it, or any tool's output changed. No
contract change, no migration.

## Left as it is

- **The evaluation itself.** An evaluated Manage or Awards (`refresh=1`)
  still reads the clan's participation: about 20,400 of its buffers are
  the members' and former members' weekly battles and the clan's
  coverage, each a member's own range.
- **The roster read** behind the drill-down (about 1,300 buffers) checks
  the member and names them; it is the roster tool's whole read.
