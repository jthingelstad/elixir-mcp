# 2026-11-09 — Home keeps reading when the log lands before the profile

Codex on #741: Home took the status read's answer only while its own read
showed the battle log unread. A log read that lands before the profile (an
empty log, so no battles and no profile yet) made Home's own read look caught
up, so later status reads were ignored and the Welcome steps stayed until a
reload.

What changed (web only): `useFirstRead` prefers the status read while Home's
own read is incomplete, meaning the log is unread or nothing is on record. When
the status read shows the profile but Home's read does not, Home's reads
(`["me", "home"]`) refresh once. `home.first_read_landed` still counts the log
read landing on an open page, so it does not fire here: the log was read
before the page.
