# 2026-11-12 — Clan's Feed in pages, its panels beside it (G3)

The canvas check of 2026-11-12 (G3) found Clan › Feed 8,647 px tall with 150
lines, and its You here and This week panels after all of them, still on
"Reading…".

- **Pages.** The Feed draws the first 30 lines of the read and **More** adds
  30 at a time (`FEED_PAGE` in `clan-web/src/views/Feed.jsx`). The read is
  unchanged: one seven-day timeline, capped by the timeline's own rules.
- **Layout.** The panels sit in a side column on a computer (the Home split,
  3fr and 2fr) and between what waits for you and the timeline on a phone
  (the main column is `display: contents` under 760 px, with `order`).
- **Why the panels stayed on "Reading…".** The web logs show the Feed's four
  reads (`/actions`, `/me`, `/week`, `/feed`) started together and ended
  together: all four 504'd at 18.5 s at 17:13 UTC, and 25 s later all four
  took 14.5 to 15.7 s, while `/actions` alone took 4.8 s a minute earlier.
  The timeline read slows everything beside it on the same environment and
  database. The Feed now holds the timeline until the other three have
  answered (success or failure), so the panels answer at their own speed.
  The timeline's own cost is the shared slowness of #649; the Feed's read now
  logs its parts (`at: "clan_feed"`, beside Home's `latest_parts`) so the
  slow builders can be named.

No contract, API or migration change.
