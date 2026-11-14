# 2026-11-14 — Five dead columns dropped; the Top 100 and Card of the Week kinds removed

Jamie approved both on 2026-11-14 ("Remove those email kinds.").

## Columns (migration 0266)

`claim.share_battles_with_clan`, `gateway.iam_user_name`,
`gateway.fetch_points`, `poll_state.heat_updated_at` and
`account_clan_declined.declined_at` had no reader or writer: `git grep -w`
over apps, packages, services, infra, acceptance, e2e and scripts found
only stale comments and test fixtures (removed here), and no view,
index, constraint or trigger names one. No `select *` reaches a response
from these tables; the `{poll_state}` diagnostic op's `select *` simply
stops printing the dropped column.

`share_battles_with_clan` was the battle-sharing consent toggle (0006):
a clanmate's non-war battles needed its owner's opt-in. Jamie retired it
on 2026-09-03 ("being in a clan is sharing your battles with it";
battlelogs are public in-game and through the API), and d5378093 removed
its route (`/api/me/share-battles`), its UI and the `war_only` lane; it
has been unread since. No privacy behaviour changes with the drop.

## Mail kinds (migration 0267)

`top_100` and `card_of_week` leave `PRODUCT_EMAIL_KINDS`,
`RETIRED_EMAIL_KINDS`, `EMAIL_KIND_CLASS` and `KIND_LABELS`. The send
paths (`runEmail`, `deliver`, the jobs handler's `{email}`) now refuse
any kind that is not active (`isActiveEmailKind`), with reason
`unknown_kind` for a name no longer known and `retired` for the three
folded kinds. The relay treats a removed kind as any unknown kind: a bad
message (none can be produced).

- **Old unsubscribe links.** `GET` and the page's `POST` answer the
  "This email has ended" page; a mail client's RFC 8058 POST gets `ok`;
  nothing is written. Any token whose kind has no switch does the same.
- **Stored rows.** 0267 deletes the two kinds' `account_email_pref`
  rows. Sent records (`email_issue`, `email_send`) stay: the readers
  (the person's and Admin's send lists and records, feedback's
  `send_kind`) never needed a known kind, and a removed one's label
  reads "Retired email". The retention trim takes them at a year.
  `account_event` details naming a kind are history and stay. The
  `mail/sent/` archive key is `dt=<day>/send_id=<id>.json.gz`, no kind.
- **Constraints.** The kind columns carry a format CHECK only
  (`^[a-z0-9_]{3,32}$`, 0138), no list of kinds.
- **Contracts.** The kind list is not served by MCP or `/api/v1`
  (`GET /api/me/email` is the web app's own route and lists active kinds
  only): MCP and JSON API unchanged.
