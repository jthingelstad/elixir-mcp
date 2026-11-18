# 2026-11-18 — Bound the member Timeline's post reads

The seven-day query applies its time window while selecting candidate posts
for each player and account. Previously, adding 10,000 older clanmate posts
made PostgreSQL visit over 30,000 shared buffers to return one recent post.
Migration 0307 indexes the last change time by author and by visible player.
An old post edited in the window still qualifies, and the feed still sorts by
creation time. The creation-based New count keeps its own watermark. The
scratch plan test covers own posts, player follows, account follows and
current clanmates. This changes an internal member read only.
