# Comments: the second round of Codex findings (2026-11-17)

Codex read #1081 (the comments screens) and #1082 (the first round of
fixes) after both merged. Four findings, each valid and fixed here.
Comments stay behind `CommentsEnabled`, off by default; nothing here
changes what is promised.

- **A blocked player's page offered Follow and Block, not Unblock
  (#1081).** The player read's `you` now carries `blocked`: whether the
  reader blocked the account that verified this player. It is read in
  readerSide's one statement, so the page's statement budget holds. While
  it stands, the header offers Unblock alone, as the account page does,
  and the Identity line drops Block. A block the other way is never said.
- **An ended pause still read as paused (#1081).** `commentSettingOf`
  returns `suspended_until` only while it is in the future, the same
  condition `openOwners` enforces; Settings compares it with the clock it
  reads once per visit as well.
- **Admin's pause line counted paused checks, not the cap's state
  (#1081).** `GET /api/admin/comments` says `month.paused` by the check's
  own condition (no cap, or this month's spend at it), and keeps the count
  of checks the cap turned away as `month.paused_checks`.
- **A report on an item seen through a followed clan was refused
  (#1082).** A comment stores its player alone, so the report rebuilt the
  item from that tag and dropped the clan. The report now takes the
  card's `subjects`, as the list and the post do. They only narrow: the
  item is rebuilt from the reader's own follows, so naming subjects never
  opens an item the reader cannot see (pinned by a test).
