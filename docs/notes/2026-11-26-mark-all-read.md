# 2026-11-26 — Mark all read

Jamie, 2026-11-26: "Notifications dropdown needs a 'Mark all read'
option."

Opening the bell already moved its seen marker (cheers, followers, your
account's lines), but answers to feedback and comments stayed new until
each was opened, so the badge could not be cleared in one place.

## What changed

- `PUT /api/me/bell/read-all` (`services/web-api/src/routes/bell.mjs`,
  `markBellAllRead` in `services/web-api/src/bell.mjs`): one transaction
  whose `now()` is the cutoff. It moves `bell_seen` forward to it, marks
  the account's answered feedback seen (`response_seen_at`) where the
  answer is at or before it, and, while comments are on, advances every
  `comment_conversation` of the account to its latest visible comment at
  or before it, pruning the receipts the cursor now covers as a thread
  read does. The session's account only, the contract header required as
  for `/seen`; only forward, so a repeat changes nothing. It returns
  `seen_at` and how many answers and conversations moved.
- The dropdown (`apps/web/src/shell/Bell.jsx`): **Mark all read** in its
  head beside Close, a 44px target, shown while anything is unread (the
  read's count, the rows shown as New, or a cached thread with unread
  replies). The tap is optimistic: the cached read (`bellAllRead`) and My
  conversations' unread counts go to zero, the open sheet's New rows move
  to Earlier, and a refusal puts both back and says so; either way both
  are read again.
- Docs: `your-account.md` (Notifications).

## The activity mail

"Cheers on your play" counts from the later of `bell_seen`, its last
send and a day ago (`services/jobs/src/email/activity-today.mjs`), as
push does. Mark all read moves `bell_seen` as opening the bell does, so
what it covered is not mailed. The mail carries cheers and followers only,
so answers and conversations do not touch it.

No migration; JSON API `/api/v1` and MCP unchanged.
