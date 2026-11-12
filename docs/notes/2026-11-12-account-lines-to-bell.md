# 2026-11-12 — Your account's lines leave Home's feed for the bell

G2 of the side-by-side walk (Jamie, 2026-11-12: "Approved: build
side-by-side fixes G1 to G9 in elixir-mcp, merging and deploying each when
green"). Live, a burst of follows put dozens of "Your account: claim added"
and "Your account: recording started" lines in Home's feed: 150 items under
Everyone (the timeline's cap, so play was cut to make room) and 71 under
You. Adding a player logs `claim_added` and then `recording_started`, so a
run of follows alternates the two kinds and the timeline's burst fold
(same kind within a minute) never folded them.

- **The cut is at the read.** `buildTimeline` takes `accountLines` (on by
  default). Home's feed, now its own read `GET /api/me/home/feed`, passes
  false, so the account's administration is never built and spends none of
  the cap. The RSS feed passes false too (it already dropped these lines
  after the cap, so its items do not change, but they no longer crowd play
  out of it), and so do the bell's reactions read and the cheers lookup,
  where these lines could never be cheered.
- **Unchanged:** `GET /api/me/timeline` (Settings' Timeline page and an
  agent's console) and `elixir_timeline` keep every account line, folded
  as before. The hub serves everything (the timeline brief, principle 7).
- **The bell's fourth section, Your account:** the last seven days of
  `account_event` except sign-ins (Settings › Sign-ins & devices) and
  feedback answers (their own section). Each kind's events within ten
  minutes of each other are one line however other kinds interleave,
  "Recording started for 24 players"; a line about one player names it and
  opens their page, the rest open Settings. A line is new after the bell's
  marker and counts in the dot.

No migration; MCP and the JSON API unchanged.
