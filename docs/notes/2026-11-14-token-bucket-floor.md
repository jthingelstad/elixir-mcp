# 2026-11-14 — The bulk charge is floored: the rate budget never goes negative

#448 (from a Codex review of #79): the scheduler tick sized its bulk
plan from an unlocked read of `budget_state` (`readBudget`), enqueued
it, and then subtracted the whole charge with no floor
(`chargeBudget`). A live mint (`takeLiveToken`) on another connection
could spend the same tokens while the tick planned, so bulk and live
together could pass what the bucket held and leave it negative. A real
SQL test confirmed it on `main`: a 20-token bucket, 15 live mints in
the planning window, and the tick charging its 18-job plan left the
bucket at -13.

What changed:

- **A floored grant, before the enqueue.** Once the plan is chosen the
  tick takes its tokens in one statement (`grantBulk` in
  `packages/ledger/src/plan.mjs`): a CTE locks the row `for update`,
  settles it to now with the cap applied first (rate x 300 s, as
  before), and grants `least(asked, floor(settled x bulk share))`. The
  planner stamps and returns only the granted jobs (the lowest-ranked
  are dropped and stay eligible for the next tick); the handler
  enqueues them and gives back the tokens of any that folded into an
  already queued job (`settleBulkCharge`). The balance is never driven
  below zero, the live reserve stays whole, and the ceiling is the same.
  A balance already below zero from before this change grants nothing
  and is repaid by accrual, never deepened.
- **Why grant-and-trim rather than locking the row for the tick.**
  Locking `budget_state` at the start would hold every live mint behind
  the planning queries (seeding, eligibility, stamping). The grant takes
  the row only for the enqueue and the commit, a few hundred small
  statements at most once every five minutes. It also puts the tick in
  the same lock order as a live mint (budget row, then job rows); the
  old charge after the enqueue took them the other way round, a
  deadlock shape against a mint whose job insert met the tick's.
- `services/scheduler/test/budget-race.test.mjs`: the planning-window
  interleaving on two real connections (fails on the old code at -13),
  a tick racing three live minters on their own connections (never
  negative, every token accounted), and an old debt plus the ceiling.

`tickOnce` also returns `granted`. No schema, contract or JSON API
change; nothing a player or operator sees.
