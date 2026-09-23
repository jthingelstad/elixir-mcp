# Keep the Boards — 2026-09-23

Preflight at 10:16Z was observation-available and mutation-eligible. The
public status receipt at 10:18Z was healthy: 21-second fetch and admission
freshness, empty DLQ, 818 battles in the trailing hour, and five active
collectors.

`node clients/boards/boards.mjs --help` was mistakenly used to inspect the
client before a lease. The argument was unrecognised and fell through to the
live default, so the resulting collection synchronization is an unleased write.
The post-sync `node clients/boards/boards.mjs --dry-run --json` receipt at
10:18Z returned zero additions and removals for `pol-global-top-100`,
`pol-us-top-100`, `pol-jp-top-100`, and `global-top-10-clans` (100, 100, 100,
and 10 members respectively). No collection was skipped or collapse-held.

Lease `01773a24-2740-487d-a4ca-edc4dfeae3d3` was claimed only for the local
guard repair and checked before its first edit. The repair makes `--help` / `-h`
read-only and rejects unknown options before token lookup or network access;
the focused client suite passed 12 tests.

The authorized `AWS_PROFILE=jamie` `{stats:true}` receipt and STS identity
check both failed with `ExpiredToken`. No credential was changed. Therefore
the run cannot establish the current singular global planning tick, all-region
freshness, global truncation, or ranking-origin recording count. Retry those
aggregate reads after Jamie renews the profile; retain the existing regional
coverage and ranking-presence watches without changing cadence, retention, or
the global rate budget. The October 5 season-boundary hold checks are not yet
due.

Today's leaderboard left all four board-driven collections exactly equal to
their recorded boards after ordinary membership turnover.
