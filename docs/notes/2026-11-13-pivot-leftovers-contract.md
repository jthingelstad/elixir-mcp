# 2026-11-13 — The pivot leftovers' contract step

Migration 0257. No contract change: every tool, route and mail answers as
before. The schema half of `2026-11-13-pivot-leftovers.md`; the code that
read and wrote these objects left in #925, #928 and #930, so deploy those
first (they are on `main` before this).

**The deploy drops stored tables.** Take an RDS snapshot first.

## Dropped

| Object | Why nothing needs it |
| --- | --- |
| `player_activity` | The Settings year graph's histogram (0084). Its route and the jobs Lambda's `{activity_histogram}` left in #930. |
| `integration_usage`, `integration_profile_refresh` | An integration's daily calls and profile refreshes (0058). `/api/v1` is `GET /api/v1/me` alone since #925. |
| `integration.scopes`, `daily_limit`, `hourly_limit`, `refresh_limit` | The integration door's grants and limits. The `{integration}` op's `list`, `revoke` and `revoke_legacy` read the account, its name, `created_at` and its keys. |

## Tightened

`oauth_code_resource_shape` and `oauth_family_resource_shape` no longer
admit `/i/<public_id>/mcp`, the integration door no credential ever
opened. They keep the literal host and exactly `/mcp`, `/api/v1` and
`/a/<8-16 lowercase alphanumerics>/mcp`, the three shapes
`RESOURCE_PATH_RE` names.

## Kept

The `integration` table (Clan's morning run reads `name = 'elixir-clan'`;
the op lists and revokes), `service_token`'s `integration_api` audience
and `attested_fact`.

## Guards

`services/migrate/test/pivot-leftovers-gone.test.mjs` refuses any source
that names a dropped object again (for `player_activity`, only SQL that
touches a table: the timeline kind of that name stays).
`services/migrate/test/pivot-leftovers-schema.test.mjs` reads a migrated
scratch database: the tables and columns are gone, and both CHECKs refuse
`/i/` and take the three doors.
