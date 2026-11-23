# 2026-11-23 — Check for new battles reads the profile and says what it found

The button on every player page (2026-11-14,
`docs/notes/2026-11-14-own-refresh.md`) read the battle log and then said
"Updated just now", whether or not anything had come in. A refusal with no
wait to name (no token free) said nothing at all. The owner asked for the
tap to pull the player's profile as well, and for the button to say what
it found.

## What changed

- **The profile on a tap.** `POST /api/me/refresh` with `player_tag` and
  `tap: true` also asks the live lane for a recording `player` read of
  that player (`readProfile` in `services/web-api/src/own-refresh.mjs`):
  on anyone's page, and on your own (your own refresh, plus the tapped
  player's profile). Only a tap sends `tap`; the app's automatic asks
  (opening, coming back, the freshness chip, the pages that ask on open)
  never read a profile. It is asked only when the battle-log half went
  ahead (`fresh` or `queued`), so a limit's refusal, or an unknown player,
  reads nothing.
- **Its charge.** One token from the one global bucket, as every live
  read takes, and nothing else: no `refreshone#`, `refreshother#`,
  `liveday#` or `refreshday#` unit. A profile read in the last ten minutes
  (`PROFILE_FRESH_S`) is fresh enough, and one already on its way is
  joined (a queued bulk job moves to the live lane), never minted twice.
  With no token the battle log still goes ahead and the profile is
  `skipped`. A failure is `skipped` too, and never changes the battle
  log's answer. Each player in the answer carries `profile` (`fresh`,
  `queued`, `skipped`) and the answer carries `since`.
- **`since`.** The ask reads what Elixir had before it (`profileFacts`:
  the name, the clan the latest profile named, trophies and arena from the
  latest snapshot, best trophies and the Ranked league from the latest
  profile, and when that profile was read) and hands it back, with the
  ask's time on the database clock, as an opaque base64url marker.
- **What the check found.** `GET /api/me/refresh?player_tag=&since=` adds,
  to the page player's entry, `new_battles` (the player's battles first
  stored since the ask: `battle.created_at`, which the enrich upsert never
  moves), `newest_battle_at`, `latest_is_new` (whether the newest battle
  is one of them), `profile_read_at`, `profile_pending` and
  `profile_changes` (name, clan, trophies, best trophies when it rose,
  arena, league; listed only when a profile newer than the one before has
  landed, so a first profile says nothing moved). Without a marker, or
  with one that is unreadable or older than 15 minutes (`SINCE_MAX_S`),
  the answer is the old one. On your own player the read is your own
  refresh's (every own player, `feed_current`), and the tapped entry
  carries the same fields.
- **The button** (`apps/web/src/home/RefreshPlayer.jsx`,
  `lib/own-refresh.js`). "Checking…" with a line saying Clash Royale is
  being asked for the battles and profile; then, for two minutes, "Check
  again" and what was found: "3 new battles. Last battle Sat 8:42 pm.",
  "Found 2 older battles." when the new ones are older than the newest,
  "No new battles. Last battle …", or that Elixir has no battles for them
  yet; and the profile's moves in game words ("Trophies 12,560 → 12,593",
  "New best", an arena, "League Master II → Master III", "Joined" or
  "Left" a clan, a new name). The page's player reads are refreshed once
  the profile has landed too, so the header's trophies move. A slow read
  says "Still checking. New battles show up here shortly." and keeps
  reading every 20 seconds, nine times at most, never while the tab is
  hidden; a newer tap ends it. A refusal with no wait to name, or a failed
  ask, now says "Couldn't check right now. Try again in a bit."; a limit
  still says "Try again in N min". The own page's button is now its own
  refresher for that player (it was the app's shared one), and what lands
  refreshes Home too.

## A profile read of a player Elixir does not record

The same read `players_profile` with `live: true` has always made. It
writes the game's public facts for that player: the player row, the
profile's clan membership and a clan stub, the daily snapshot, the
collection, badges, mode seasons, the receipt, the payload hash and the
archive, all under their existing retention. It starts no recording: the
planner plans from `recording` only, so the `poll_state` row the receipt
stamps plans nothing, and the clan follow on a profile acts only for an
account whose primary claim is that player. A ghost player stays out of
metrics as before.

## [engineering] decisions

- The profile costs the global token only. Its bounds are the ten-minute
  freshness per player, the join, the route's 60 asks an hour per account
  and the global bucket; a second personal unit for the same tap would
  charge the person twice for one ask.
- Ten minutes of profile freshness: trophies move once a battle, the rest
  far less often, and a person who checks after every battle reads one
  profile per player per ten minutes.
- The comparison is on the server, against values captured at the ask,
  because the day's snapshot row is overwritten during the day. The
  marker is unsigned: it carries public game facts the page already
  shows, and a changed marker changes only what that reader is told.
- "New" is new to Elixir since the tap (`battle.created_at`), not newer
  than the last shown battle, so older battles a read fills in are
  counted and said as older.
- The slow path is about three minutes (`SLOW_POLLS` 9 × `SLOW_WAIT_MS`
  20 s), well inside the marker's 15 minutes.
- The What's new entry is unmarked: it improves an existing button, and
  one marked entry already went out today.

## Not changed

- The header's clan line follows the clan's roster, not the profile, so a
  joined clan shows there when the roster is next read; the check's line
  says it at once.
- On your own page, a tap inside your own five-minute floor, with the
  reads already done, is still "Try again in N min", and reads no profile.
