# 2026-11-13 — The clan's lock is held around writes, not record reads

**Before.** Every Clan request on a clan path outside the pure views, and
every write, took the session advisory lock `clan-state:<tag>` on its
leased connection and held it through the whole handler and the Discord
share. Opening Actions, Manage, Policy, Standing or Awards read the record
(participation, activity evidence, roster) under that lock, GET `/actions`
for up to 15 s at p95, while other requests for the same clan sat in
`pg_advisory_lock` holding pooled connections (`DB_POOL_MAX`, 4 an
instance) until the pool starved.

**The invariant.** The lock serializes read-modify-writes of a clan's
ledger. An evaluation reads the cards, holds and last snapshot, judges,
then raises and withdraws Actions, writes outcome verification and away
closes with plain `putCard` from that read, numbers Actions and saves the
verdict snapshot; the awards evaluation does the same with plans, grants,
award Actions and its snapshot; `discord.share` hands Actions to Discord
and must never post one twice. Unserialized, two evaluations raise the
same Action twice, a `putCard` from a stale read writes over a decision,
and a share could post twice.

**What changed.** The manage and awards services take an
`exclusive(clanTag, fn)` dependency (the web API's session advisory lock
on the request's connection, keyed through one normalizer so O/0 aliases
share it; `fn()` in the morning run, which already holds the lock). Each
evaluation reads the record first, holding nothing, then inside
`exclusive` reads the policy or awards document, the snapshot and the
ledger again and judges and writes from those reads. A snapshot saved by
an evaluation that started later is taken as it is rather than judged
over from older reads; a policy saved meanwhile is judged by, with its
reads made again. Numbering legacy Actions in a view goes through
`exclusive` too.

GET `/actions`, `/actions/<n>`, `/manage`, `/history`, `/policy`,
`/standing`, `/awards`, `/awards/manage`, `/trophies` and POST
`/policy/preview` (which writes only the monotonic size observation) no
longer take the request lock; their Discord share runs under
`exclusive`. Every other write, and every other read that may write,
keeps the request lock as before, including the model drafts
(`/actions/*/draft`, `/recruit/draft`), whose draft bookkeeping was not
narrowed. `clanLockPlan` in `services/web-api/src/clan.mjs` is the one
place that decides.

**Tests.** `services/web-api/test/clan-lock.test.mjs`, on scratch
Postgres with two connections and barriers: two evaluations reading the
record together raise each Action once (and fail without the lock); an
earlier evaluation takes a later one's snapshot; a decision made while an
evaluation reads stands; the locked half waits on a held lock while the
record reads do not; the lock plan per route. In `clan-session.test.mjs`,
the narrowed views answer while another connection holds the clan's lock
(through an O alias), and a policy save still waits on it.

No contract, migration or user-visible change.
