# 2026-11-12 — The approval era retired

Jamie, 2026-11-12: "approval-era and retired code goes, Admin Requests
and beta pulse included" (DECISIONS, "Approval-era and retired code
goes"). No MCP contract change, no migration, no What's new entry.

## Removed

- **Admin ▸ Requests and Admin ▸ Beta pulse** (`/settings/admin/requests`,
  `/settings/admin/pulse`). Accounts is Admin's first page now; those two
  addresses, and their `/console/admin/...` forms, land on it through
  `settingsLegal`, the same way any page Admin does not have does.
- **The routes:** `POST /api/request-access`, `GET /api/admin/requests`,
  `POST /api/admin/decide` and `GET /api/admin/pulse` answer 404.
  `requestAccess`, `decideAccess` and `pendingRequests` left
  `@elixir-mcp/auth`; `services/web-api/src/beta-pulse.mjs` and
  `apps/web/src/lib/pulse.js` are deleted with their tests.
- **The staff notices** `access_request`, `approved_welcome` and
  `role_upgrade_request` (the tier-upgrade notice, which nothing had sent
  since tiers became earned) left `OWNER_NOTIFY_KINDS`, the relay's
  subjects and the mail preview. A message of one still queued renders as
  the generic notice. The remaining notices link `/settings/admin/...`.
- **Card of the Week, Top 100 and the issue queue's manual entry points**
  in the jobs Lambda (`top100_*`, `issue_accept`, `card_of_week_*`) are
  no recognized op.
- **Leaderboard path builders** in `CR_PATH_BY_ENDPOINT`. `crPathForJob`
  still refuses the retired endpoints by name
  (`RETIRED_RECORDING_ENDPOINTS`) for any old lease or archive.

## Kept, and why

- **Pending members' rows.** `publicLoginAccount` and
  `openVerifiedAccount` still open a `requested` member's account on a
  proved address: rows from the old form may remain, and that is a live
  reader.
- **`account.request_note` and `requested_player_tag`.**
  `requested_player_tag` is written by every signup that names a tag.
  `request_note` now has no reader, but it holds what people wrote when
  they asked to join; dropping it destroys words nobody can rebuild, so
  it is Jamie's call, not this change's.
- **Blocking an account.** Admin ▸ Requests' Deny was the app's only way
  to set `denied`. `{account_remove}` remains the path for an account
  that must go.
- **The `top_100` and `card_of_week` email kind names** in
  `PRODUCT_EMAIL_KINDS`, and their labels in `packages/mail`: sent
  records, stored switches and old unsubscribe links read them, and that
  code is the one-email change's.
