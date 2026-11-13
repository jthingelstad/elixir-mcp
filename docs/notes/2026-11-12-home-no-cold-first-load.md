# Home: no cold first load (#649, round four)

2026-11-12.

## Before

The 503 at 00:03:08Z on 2026-11-13 (`GET /api/me/people/suggested`) was
`db_connect_failed` after 2,501 ms with connect_ms 0 and no retry: a full
pool, not a slow statement. The web function runs eight requests per
environment over four clients (`DB_POOL_MAX`), and at that moment four cold
builds held all four: the bell (5.9 s, `stored:false`, no `bell_week` row
yet), the clan card (9.2 s, `stored:false`, built twice by two page loads),
the feed (2.9 s) and the week (3.4 s). The client's one retry got 200 in
422 ms. `week` and `needs` were slow in the same seconds because they
queued behind those builds; warm, they read in 26 to 924 ms.

## What changed

- **The bell is built by the wake.** `refreshHomeWeek` built the bell only
  when a row already existed, so the first bell read was always cold. It
  now builds a missing row too.
- **A week away stays warm.** The five-minute rule (`homeWeeksToWake`) also
  wakes accounts that read Home in the last seven days and whose row is
  over two hours old (under the three-hour SERVE), recent readers first.
  Ten wakes per run, one build each, as before.
- **The clan card is served stale, never built on expiry.** A card on the
  same basis (clan, Clan's basis digest, state) is served up to seven days
  old with `refresh:true`, and the page asks `?rebuild=1` as before. A
  different basis (role, verification, policy version, holds), a departure
  the gate refuses, or another clan still builds at once; Clan's gate,
  role and Actions are still read live on every read. A rebuild that finds
  a card under fifteen minutes serves it.
- **One build per row per account.** `buildOnce` (home-feed.mjs) takes a
  session advisory lock (`pg_try_advisory_lock(hashtext(name),
  hashtext(account))`) around the home week, bell week and clan card
  builds. A second reader polls `pg_locks` (100 to 800 ms backoff, up to
  12 s), then reads the row the first stored, building only if it still
  cannot serve one. The lease's `DISCARD ALL` releases a lock a failed
  request left.
- **People to follow** already degrades inside the route (`panel()`), and
  the client retries a 5xx once after 1.5 s. A full pool fails before the
  route runs, so the fix is fewer cold builds holding clients; the panel
  now also offers Try again.

## Not changed

Pool size (4) and per-environment concurrency (8). Raising the pool would
spend database connections on a db.t4g.micro; with cold builds gone the
four should hold. Revisit if `db_connect_failed` recurs.
