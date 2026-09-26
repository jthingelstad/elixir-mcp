# Keep the Boards — 2026-09-26

Preflight was observation-available and mutation-eligible; `main` was clean
and synchronized. The documented `cloud-engineer` identity was
`ProjectsCloudEngineer`, and the read-only `elixir-mcp-migrate` `{stats:true}`
receipt established today's board health:

- one global `rankings_pol` receipt in the 10:00Z--10:15Z window;
- global snapshot observed and confirmed at 10:07:54Z, with 1,000 entries and
  `truncated: false`;
- 172 of 262 enabled regional boards fresh within 26 hours, leaving 90 stale;
- 608 active ranking-origin recordings; and
- eight `rankings_pol` HTTP 404s among the trailing day's 21 fetch errors.

The season-boundary checks do not apply: the next roll is 2026-10-05T10:00Z.
The regional and ranking-recording counts remain objective gaps. The aggregate
receipt does not identify the stale board subjects or establish a cause, so
this run did not change the daily cadence, ranking-presence retention, or the
single global rate budget. Keep the Boards retains the presence watch; Run
Elixir MCP owns the regional planner/collector/admission seam.

Lease `ee7b4ef3-798c-452f-b9c4-f88969507fb5` was claimed and checked directly
before the only production write. `node clients/boards/boards.mjs` completed
without skips or collapse holds:

- `pol-global-top-100`: +47 / -47;
- `pol-us-top-100`: +34 / -34;
- `pol-jp-top-100`: +37 / -37; and
- `global-top-10-clans`: +2 / -2.

The post-sync `node clients/boards/boards.mjs --dry-run --json` receipt had
zero additions and removals for every collection (100, 100, 100 and 10
members), proving each equals its recorded board at read time.

Leaderboard result: the global top 100 turned over 47 players, while the
United States and Japan boards turned over 34 and 37 and two of the top ten
most-represented clans changed.
