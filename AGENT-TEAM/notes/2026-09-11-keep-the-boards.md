# Keep the Boards — 2026-09-11

Preflight at 2026-09-11T09:19Z: mutation eligible, checkout clean and
synchronized; the public-status observation was unavailable. Reviewed
`77718bec208366279f0df0c649d9e97cd4c2d01e`, the current recording/roles/
connections docs, contract changelog, and recent board decisions.

The board sync was deliberately not run for real. Its read-only dry run hit
the MCP door's 25-second timeout for global and US and reported those failed
reads as empty boards; Japan returned 38 players and the global clan aggregate
returned 10 clans. A subsequent isolated global `rankings_players` read
succeeded: 996 entries, `truncated: false`, observed and confirmed at
2026-09-11T08:32:57Z (under the two-hour objective bound). This establishes
that the initial empty global result was a transport failure, not a collapsed
board, and the collections were left unchanged.

The service incident is live, not a board-data fix: `/api/public/status` timed
out with no response after 20 seconds; the scheduler timed out at 09:22Z and
09:24Z; several MCP reads timed out at 25 seconds. The migrate reader was
unavailable because its one reserved concurrent invocation was occupied, so
the required all-location and ranking-origin census could not be obtained.
CloudWatch showed individual board reads completing only intermittently.

Next Boards run: retry the status, migrate statistics, 24-hour global timeline,
and all-location freshness only after the Run Elixir MCP owner has cleared the
service timeouts; then run the real client only if every board read is healthy.
