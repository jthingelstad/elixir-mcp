# 2026-10-21 — The stats refresh keeps a day of marks, so a deploy burst cannot force full counts

The hourly stats refresh recounts the fetch series only from the day
the newest receipts reached. It starts from a mark at least an hour
older than the newest one (`2026-10-21-heavy-statements.md`). Every
refresh adds a mark, and so does the refresh each platform deploy runs.
Six marks were kept, so six refreshes inside one hour would push out
every mark an hour old. The next refresh would then count the whole
series: about 18,000 blocks from disk, 1.6 s.

The read-back after #638 came close. Five refreshes ran between 07:05Z
and 08:05Z on 2026-10-21: two hourly runs and three deploys. The full
counts seen that morning had a different cause. The state was new
(#627 deployed at 06:46Z), so at 08:05Z no mark was yet an hour older
than the newest. At 09:05Z the oldest mark, from the 07:05Z run, was a
fraction of a second short of an hour older than the 08:05Z one. Both
runs counted in full (1.66 s and 1.63 s in the slow-statement log). `{profile_read}` `public_stats` named `2026-10-21` from 09:08Z on.
Once a state has more than two hours of marks, an hourly run that
misses its mark from the hour before uses the one from the hour before
that.

`MARKS_KEPT` is now 24 (`packages/tools/src/public-stats.mjs`). A busy
deploy day costs no full counts unless 24 refreshes land inside one
hour, and the state row grows by about 1.5 KB.
`services/jobs/test/public-stats.test.mjs` runs eight refreshes in a row
after hourly marks and requires none to count in full. With six kept
marks, the seventh counted in full and the test failed.

The counts stay exact. There is no migration, contract or JSON API
change. No tool reads the snapshot, so the deploy runs no acceptance
family.
