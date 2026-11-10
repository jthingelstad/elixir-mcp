# 2026-11-09 — Clan's participation read: no table scan, one computation per page

Every `GET /api/clan/clans/*` read was over its 1500 ms p95 ceiling
(`2026-11-09-web-latency-report.md`), and 78 to 100% of that time was
`clans_participation`, the eight-week read nearly every Clan panel
evaluates from (issue #296).

## Where the time went

Read-only, 2026-11-09, on the live clan:

- **The Clan door's trace lines** (`elixir` per call, 7 days): each
  request calls `clans_participation` once, for eight weeks; no request
  calls it twice. A page asks for three or four panels at once (`home`,
  `me`, `week`, `actions` within 100 ms of each other), and each of those
  requests computed the same read side by side: about 1.0 to 1.4 s when
  one ran alone, 2 to 6 s (10.8 s at worst) when they raced.
- **`{profile_tool}` of the read** (27 statements, 1,046 ms of database
  time): `donations_by_week` was 412 ms, the one statement that cost the
  same on every run. `{explain_participation}` (plan only) shows why: the
  planner costs a clan's scattered day rows (estimate 3,702) above a
  sequential scan of `player_snapshot_daily` (8,926 pages,
  `random_page_cost` 4), and a scan that size goes through a small ring
  buffer, so every call read about 8,600 pages from disk and never warmed
  the cache. The rest are 26 short statements, none over 160 ms, whose
  times moved between runs with what was cached.

## What changed

- **The two weekly donation statements read each member's own key
  range** (`participation-sql.mjs`): `max(donations)` and the snapshot
  count per ISO week are grouped inside a lateral per distinct tag, which
  the planner cannot flatten into a join, so each member is a range read
  on the primary key `(player_tag, snapshot_date, snapshot_kind)` and the
  pages it touches stay cached. The rows and their grouping are the flat
  statement's. `{explain_participation}` explains the new text, since it
  imports the same SQL.
- **Identical reads in flight together share one computation**
  (`services/web-api/src/shared-read.mjs`, wired for `clans_participation`
  in `clan.mjs`). A request that arrives while the same person's read of
  the same clan and arguments is running waits for it instead of starting
  its own. [engineering] Nothing is kept: the entry goes the moment the
  read settles, so a request that starts afterwards computes afresh, and
  no answer is older than the computation it joined (at most that read's
  own duration, about a second). Every caller gets its own copy, and a
  read that failed or threw is not shared: each waiting caller then makes
  its own. The key is the account, its time zone, the tool and its
  arguments, so no person ever receives a read made for another. It works
  within one execution environment, which serves up to eight requests at
  once (`MaxConcurrencyPerEnvironment`); a request on another environment
  computes its own, as before.

No answer changes: no contract, `/api/v1` shape or migration moves, and
weeks stay ISO weeks. `participation-plan.test.mjs` pins the new
statements equal to the flat ones row for row over a table of
day-ordered rows (repeated tags and a tag with no rows included) and one
key-range read per distinct member; `clan-participation-shared.test.mjs`
pins the tool's donation columns equal to the flat statement across a
closed war week and the current one, a member who left and a clan with
no war, and that shared answers are the read's own, one computation,
copied, never kept, failures not shared.

## Expected, and how to read it back

Before (7 days to 2026-11-09): `*/season` p95 10.9 s, `*/week` 7.3 s,
`*/me` 5.8 s, `*/actions` 5.7 s, `*/standing` 4.9 s; participation alone
1,046 ms of database time.

After the deploy: participation's database time should fall by the
donation scan's ~400 ms to about 600 ms, and a page's parallel panels
should pay for one computation instead of three or four, which is where
the multi-second tails came from. Under 300 ms for the read itself is not
reached by this change; the remainder is 26 statements, the slowest
`finishWarDays`, `buildMeta`'s source read and `war_weeks`, each under
160 ms and cache-dependent.

- `npm run web-latency -- --days 7` a week after the deploy, the
  `GET /api/clan/clans/*` rows and the Clan door's split (and `--days 1`
  for a first look, thin).
- `{"profile_tool": {"tool": "clans_participation", "args": {"clan_tag":
  "#J2RGCRVG", "weeks": 8}}}`: `db_ms`, and `donations_by_week` out of the
  slowest list.
- `{"explain_participation": {"clan_tag": "#J2RGCRVG", "weeks": 8,
  "analyze": false, "queries": ["donations_by_week"]}}`: no Seq Scan on
  `player_snapshot_daily`.
