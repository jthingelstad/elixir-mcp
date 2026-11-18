# 2026-11-18 — Keep old follow writers working through cutover

The Codex review of #1148 found that migration 0301 narrowed the claim
relationship check before the application Lambdas changed. The previous
writer still explicitly inserted Watching for later unnamed additions and
primary-player demotions. A NOT VALID check still rejects those new writes.
If a later deployment step failed, the previous application would remain
live against that narrower check.

The primary agent confirmed from the production migration logs that the
highest applied migration was 0300. Migrations 0301 and 0302 had never run
in production. This correction therefore changes only the pending 0301,
refreshing its SHA pin. Every applied file remains unchanged, migration
0302 keeps its separate validation, and no new migration number is used.

Migration 0301 now installs a compatibility trigger in the same transaction
as its conversion and check. PostgreSQL runs this trigger after
claim_follow_stamp: the clock sees an old Watching write and clears its
event time, then the compatibility trigger normalizes the relationship to
Friend. Existing converted rows keep their null followed_at and original
creation dates. Genuine new Friend inserts retain their real event date.
No account link, event, mail or push is created by the conversion or by a
legacy Watching write. Retain the trigger until old Lambda revisions can
no longer be invoked; its later retirement is a separate migration.

Regression tests fail against the original 0301, then exercise old explicit
inserts, both primary demotion query shapes, and relationship changes before
and after validation. They verify preserved dates and notification choices,
quiet bell/mail/push selectors, ordinary new follow events, and rejection
of unrelated invalid relationships. Existing conversion fixtures remove
the compatibility trigger when reconstructing historical Watching rows.
The fresh-schema fingerprint is checked even though its pinned columns,
indexes and constraints are unchanged by the added function and trigger.

This is deployment compatibility for MCP 14.0.0 and JSON API 6.0.0. It adds
no user-facing behavior, protocol change or legal wording. Production
verification uses reads only; scratch databases prove the write behavior.
