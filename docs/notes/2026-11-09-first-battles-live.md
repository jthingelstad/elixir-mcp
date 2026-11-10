# 2026-11-09 — A person's add reads the battle log live too

Jamie, 2026-11-09, on asking for a new player's battle log on the live lane
when they are added, at a second live token per new player: "adding new
players battles right away makes a ton of sense and makes first user
experience way better."

**What changed.** `requestFirstRead` (`packages/tools/src/live.mjs`) takes
`{ battles: true }`. With it, after the profile's first read, it asks for
the battle log on the live lane through the same `liveFetch`, so both
land in seconds instead of the battle log waiting for the scheduler's next
tick (`SchedulerTickMinutes`, 5) plus its queue. The `{funnel}` op measured
the live profile today at a median of 2 s and a p90 of 96 s (n 8).

- **Profile first.** The battle log is asked for only when the profile's
  read is on its way (`minted` or `joined`), so a tag the game answered
  404 for today, a profile refused for want of a token or of the pool's
  first reads, or a profile already read today asks for nothing more.
- **The same guards, on its own endpoint:** a battle log read or failed in
  the last day is not asked again; one open job per tag and endpoint (a
  re-add or a second person joins it, free); the global bucket's token is
  taken at mint and given back when nothing is minted; and the battle log
  is asked only for an active comprehensive recording, which every claim
  is (the scheduler reads a player's battle log for no other).
- **The pool.** A second allowance, `firstbattles#<owner>`, the same size
  as `firstread#` (one per player slot per UTC day; owner and admin
  exempt), so a battle log never spends a profile's read and the profile's
  allowance is unchanged. That is the second live token per new player
  Jamie accepted; no other budget moves.
- **Never fails the add.** A refused or failed battle-log mint returns
  `battles: {requested: false, reason}` beside the profile's answer and
  the scheduler reads the battle log as before.
- **Logged.** `first_read_requested` now carries `endpoint` (`player`, or
  `player_battlelog`), one line each, so `first_read_landed` for the battle
  log can be read against its request. Two new outcomes for the battle log:
  `not_recorded` and `profile_not_requested`. The ops skill's query splits
  by endpoint.

**Which adds.** Every person's add: Home and Settings (`POST /api/claims`,
including Home's Follow), signing in with the tag given at signup
(`onboardAccount` in the sign-in handler), and `elixir_track_player`, over
MCP (a person's client or their agent) and over `/api/v1`
(`POST /api/v1/me/players`, which runs the tool). `[engineering]`: the
`/api/v1` add is a family app adding a tag for the signed-in person (Drop's
saved tag, as an alt); it is the same tool and the same person's player, and
a tool that behaved differently per door would break "lay out for the door,
never change what it says" (`invoker.mjs`). Its cost is bounded by the same
pool. Not changed: the operator ops' adds (`services/migrate`
`ops-accounts.mjs`) and the admin approval's `onboardAccount`, which ask
for no first read at all today (the approved person's first sign-in does).

**Wording.** Home's step 2 now reads "Elixir reads your profile and your
last 30 battles, usually within a minute." and, once the tag is saved,
"Your profile and roughly your last 30 battles usually arrive within a
minute; at busy times it can take a few." The same promise is brought into
line in Home's Follow, Friends, Ladder's pending page, Settings' Tracking,
Explore, the welcome email, the `elixir_track_player` notes and the docs
(quickstart, recording, about, limits, freshness). "This page checks again
every few seconds for the first minutes, then about once a minute" stays:
`useFirstAnswer.js` polls every 5 s for three minutes, then every 60 s.

**The timeline DECISIONS line** written today (#738/#739) said the timeline
is computed on every read "with no stored feed". Jamie: "this seems fine… I
don't think we need a rule per se, I think this should just be based on
performance." It is rewritten as a performance choice: computed on every
read today because that meets the ceilings in
`infra/web-latency-ceilings.json`, stored when measurement says so.

MCP 11.18.6 (patch: `elixir_track_player`'s notes and behaviour, no field
change); JSON API 3.4.0 unchanged. No migration. Acceptance for the deploy:
`--acceptance=elixir`.
