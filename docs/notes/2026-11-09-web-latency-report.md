# 2026-11-09 — A web latency report, with ceilings

The signed-in web app was slow and nothing watched it: the acceptance
suite times MCP tools only, and no read timed a page. `npm run
web-latency -- --days 7` (`infra/scripts/web-latency.mjs`, the pure half
in `infra/scripts/lib/web-latency.mjs`) is a read-only Logs Insights
report over the doors' own request lines:

- **Web routes** from the web-api door's outer `http_request` line
  (`packages/http/src/server.mjs`: the real path, `status`, `ms`,
  `build`). The handler logs a second line per request with a coarser
  route key; only its `timed_out` flag is read, so nothing is counted
  twice. Paths collapse clan and player tags, action, battle, award and
  send ids and uuids (`GET /api/clan/clans/*/actions/*`), so a route
  aggregates. Only `/api/*` and `/battle/*` are reported: the app shell
  and scanner paths are not reads.
- **MCP tools** from the MCP door's tool line (`message.tool`).
- **Home by build**, newest first, so a deploy's effect is visible.
- **The Clan door's split**: its stringified trace line's `elixir_ms`
  and `store_ms` per route, as a share of the route's time.

Each route and tool gets samples, p50, p95, max, count over 3 s, 5xx and
a verdict against `infra/web-latency-ceilings.json`: 2000 ms p95 for every
`GET /api/me/home*` read, 1500 ms for `GET /api/clan/clans/*` reads, 500 ms
for `GET /api/me` and `GET /api/me/first-answer`, 2000 ms per MCP tool.
Fewer than 10 samples is `thin` and never judged; a route no ceiling
names is reported, not judged. `--check` exits 1 when any judged route
is over, `--json` prints the rows. It fails `--check` today; that is the
point.

[engineering] It is not wired into `deploy.mjs` or CI: natural traffic is
tens of requests per route a week, mostly one account, so a gate on it
would be noise. It is the answer to "why is the web slow" (the `ops`
skill, `docs/OPERATIONS.md`), and the before picture for the work that
brings these routes under their ceilings.

[engineering] `@aws-sdk/client-cloudwatch-logs` joins the root
devDependencies at the version the other SDK clients use: nothing
already installed could run Logs Insights.

No contract, JSON API or migration moves; no Lambda changes.

## Baseline, 2026-11-09

One run over the 7 days to Nov 9, 4:08 PM CT. The top 15 web routes by
p95 (ms):

| Route | n | p50 | p95 | max | >3 s | 5xx | Ceiling | Verdict |
| --- | --: | --: | --: | --: | --: | --: | --: | --- |
| GET /api/me/home | 41 | 1113 | 18364 | 18501 | 11 | 2 | 2000 | over |
| GET /api/admin/pulse | 1 | 18024 | 18024 | 18024 | 1 | 1 | - | none |
| GET /api/me/home/latest | 30 | 7081 | 15429 | 16434 | 28 | 0 | 2000 | over |
| GET /api/me/home/friends | 10 | 4885 | 13839 | 13839 | 9 | 0 | 2000 | over |
| GET /api/clan/clans/\*/season | 11 | 1136 | 10883 | 10883 | 3 | 0 | 1500 | over |
| POST /api/clan/clans/\*/actions/\*/draft | 2 | 5713 | 9746 | 9746 | 2 | 0 | - | none |
| GET /api/me/home/clan | 31 | 4927 | 9226 | 10631 | 25 | 0 | 2000 | over |
| GET /api/clan/clans/\*/week | 26 | 2213 | 7282 | 12697 | 13 | 0 | 1500 | over |
| GET /api/me/gateway-detail | 1 | 6437 | 6437 | 6437 | 1 | 0 | - | none |
| GET /api/clan/clans/\*/me | 20 | 2174 | 5824 | 7248 | 8 | 0 | 1500 | over |
| GET /api/clan/clans/\*/actions | 34 | 1153 | 5714 | 6278 | 4 | 0 | 1500 | over |
| GET /api/me/principals | 17 | 3511 | 5681 | 5681 | 9 | 0 | - | none |
| GET /api/me/timeline | 80 | 336 | 5678 | 8858 | 11 | 0 | - | none |
| GET /api/clan/clans/\*/standing | 6 | 1200 | 4877 | 4877 | 1 | 0 | 1500 | thin |
| POST /api/explore | 310 | 223 | 3393 | 18502 | 20 | 6 | - | none |

Also over: `GET /api/me/home/week` (34, p95 3335), `GET /api/me/home/needs`
(23, 2613), `GET /api/clan/clans/*/awards` (13, 2160),
`GET /api/me/first-answer` (42, 1504) and `GET /api/me` (289, 801).
Six MCP tools are over 2000 ms p95: `cards_card` (116, p95 6739),
`clans_standings` (189, 5615), `elixir_data_insights` (17, 4700),
`elixir_timeline` (2956, 4153), `badges_rarity` (63, 2178) and
`players_search` (57, 2036). 19 judged routes and tools are over in all.

The Clan door's slow reads are Elixir calls, not its own store: Elixir
is 78 to 100% of `home`, `week`, `me`, `season` and `awards` time
(`clans_participation` behind most).

**Home by build.** `GET /api/me/home` answered 504 twice, both
`timed_out` at about 18.5 s, both on build `51223aa3e7b845cc` (Nov 6,
10:52 to 10:58 AM CT, p50 10.3 s). Every later build measures far
better, on thin samples: the newest to serve Home, `8376b496e21db29d`
(Nov 9, 6:59 AM CT), had `GET /api/me/home` p50 1259 / p95 1532 (n 3),
`/latest` p95 2216 (n 2, against 9.7 to 16.4 s on earlier builds),
`/clan` p95 3320 (n 3), `/friends` 3117 (n 1). The 7-day p95 is the
morning of Nov 6, not today; the live build (`11efaf3ccd2329bf`) had
served no Home read when this ran. `/latest` and `/clan` are still
over their ceiling on the newest build.
