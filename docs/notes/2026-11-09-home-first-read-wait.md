# 2026-11-09 — Home waits for the player's own battle log

A production walk tonight added a tag Elixir already knew as an opponent: one
battle on record, from another tracked player's log. Home left the Welcome
steps for Today within half a second, because a battle on record (or a
profile) counted as "the first read has landed", and drew "Battle log read:
never" with that one battle and no trophies. The real reads landed 3 s
(profile) and 4.5 s (battle log) later, but nothing on the open page read
again: the status read polled only inside the Welcome steps, which were gone.
Only a reload showed six battles and the trophies.

What changed (web only, no contract or API version):

- **The first read is the player's own battle-log read** (`logRead` in
  `lib/record-journey.js`: `battlelog_observed_at`, the freshness the page
  shows as "Battle log read ..."). A stub's battle and a profile alone no
  longer end the wait.
- **Home owns the wait, whichever view it draws** (`home/first-read.js`,
  `useFirstRead`). One first-answer read polls as before (every 5 s for three
  minutes after the add, then every 60 s) while the log is unread or nothing
  is on record; an account whose player's log has been read polls nothing.
  While the fast window is open the steps stay up with the existing copy ("Your
  profile and roughly your last 30 battles usually arrive within a minute");
  after it, or after a failed read, Today draws with what is on record and the
  slow poll goes on. When the log lands on an open page, Home's reads
  (`["me", "home"]`) refresh once and `home.first_read_landed` (#734) is
  counted once, now at that moment rather than at the profile.
- `nextPoll` waits on the log read rather than on any battle, so the Settings
  player page and Ladder's Pending poll on for a stub too. The Settings page
  refreshes its year of battles once when the read lands; Ladder's
  `capturePending` no longer treats a battle on record as the capture, and
  `captureLanded` needs the log read.
- Today's freshness chip, unread, says the first-read line instead of nothing.

Follow and Friends add a friend, not your player; Friends is the mail's builder
and is never polled (its cost, `docs/product/home.md`), so a friend's first
read shows on the next visit.
