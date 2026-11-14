# 2026-11-14 — Dead exports removed, and knip now sees them

**Deleted** (no reader anywhere, tests included): `removedFromClan`
(record attested facts), `clanRosterAt` (record member activity),
`WAR_DECKS_PER_DAY` (record war clock), `projectProfileSeries` (ingest
series), `hasRetiredJobs` (ledger),
`TURNSTILE_SURFACES` (auth), `isoWeekStartUtc` (clan engine facts),
`POLICY_SCHEMA_VERSION` (clan engine policy; policy values carry no
schema number), `RECEIPT_PREFIX` (syndication quality; timeline-sync
names its lanes itself), and in contracts `consoleAccess` with its
`ConsoleAccess` type, `GRANTED_ROLES` and `displayCard`. Barrel
re-exports nobody imported through the barrel: `ORIGIN_HEADER` (auth),
`pixelUrl` and `TINYLYTICS_EMBED_CODE` (mail), `settingView`
(syndication); the symbols themselves stay, read from their own files.

**Kept:** `JSONRPC_QUOTA_EXCEEDED` in contracts. `-32029` is a documented
wire value (`/docs/protocol`), and the MCP door kept its own copy
(`MCP_QUOTA_ERROR_CODE`); the door now reads the contract constant and
its copy is gone. Its test pins the number itself.

**Ingest:** a successful fetch still stamps `gateway.last_success_at` and
no longer counts `gateway.fetch_points`, retired with fetch points
(DECISIONS, "Running a collector earns the Family tier"). The column
stays; dropping stored data is a separate call.

**Staff links:** You's Admin row and the shell's admin place pointed at
`/settings/admin/requests`, retired on 2026-11-12. Both open
`/settings/admin/accounts`, Admin's first page. Staff-only, so no What's
new entry.

**Guard:** the `packages/*` workspaces export every file (`"./*"`), so
knip took each file as an entry and never reported its exports.
`includeEntryExports` on those workspaces makes it report them, with
`ignoreExportsUsedInFile` so a constant exported and used in its own
file is not counted dead. Left out: `packages/contracts` and
`packages/ui` (imported as built `dist/`, so knip cannot see their
readers and reports hundreds of live exports), `packages/client`,
`packages/design`, `packages/docs`, the apps, and the services (Lambda
entries whose `handler` the runtime reads; nothing imports a service).

MCP and JSON API unchanged; no migration.
