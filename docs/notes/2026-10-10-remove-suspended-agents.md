# 2026-10-10 — A suspended agent can be removed from view

Jamie, 2026-10-10: five suspended agents on one account still filled the
console rail's agent switcher and the Agents table, with no way to set
them aside short of a delete, which agents do not have and should not
get.

Migration 0215 adds `account.removed_at`. `POST /api/me/principals/remove`
(`{ account_id, removed }`, console only, contract header required) sets
or clears it, for an agent its caller owns and only while the agent is
suspended (`409 not_suspended` otherwise, `404` for anyone else's).
Resuming an agent clears it, so a removed agent is always refused at both
doors. Nothing else changes: keys are not revoked, the account, its
`public_id`, its tracking and its history stay, and the agent's console
still opens at its address. The account log records
`principal_removed` / `principal_restored`.

`GET /api/me/principals` and `GET /api/me` carry `removed_at`. The rail's
switcher leaves a removed agent out unless its console is the one open,
and the Agents page folds removed agents into a Removed agents list below
the table. A removed agent's tracked subjects still count in the owner's
pooled slots, as a suspended agent's do.

MCP 11.7.2 and JSON API 3.1.0 unchanged; migration 0215.
