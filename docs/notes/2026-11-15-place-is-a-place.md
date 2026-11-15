# 2026-11-15 — A place is a place

Migration 0276. No MCP tool, `/api/v1` operation or contract version
changes (MCP 13.2.2, JSON API 5.1.0); one app route goes.

**Direction.** Jamie, 2026-11-15, on #1054-#1057: the consent machinery
was built for nobody. City-level location is fine for everyone, with no
legal or consent gate. A person with a verified player sets a country,
region or city, and it shows on their clans' maps, on the player map and
in Near you. To stop appearing, they remove their place.

**What changed for people.** The picker, Your place on Profile and What
members see's Location say one sentence: "Who sees it: your clan's
verified members on the clan map, and anyone signed in to Elixir on the
player map and in Near you." Gone: the "Who sees it" radios (My clan maps,
the player map and Near you / My clan maps only), the one-time "New: the
player map" prompt with Join the player map and Keep clan maps only, Join
and Leave the player map on Profile and in Near you, and Near you's "on
your clan maps only" line. Near you now reads "People who set a place in
<region>" and, when empty, "Nobody else in <region> has set a place yet."
A What's new entry (2026-11-15-02) says how to remove a place.

**Migration 0276** (`db/migrations/0276_place_one_setting.sql`), over the
`place#<tag>` rows of `clan_state` only, three set-based statements:

1. Delete every place row no current verified own claim (primary or alt)
   owns under the rule the readers used until now: a stamp naming the
   claim's account, or no stamp and a `set_at` at or after the claim's
   `verified_at` (or a claim from before that column). A malformed
   `set_at` counts as not after. What goes is a former owner's place
   behind a moved or ended claim, which no reader showed.
2. Stamp each remaining unstamped row with its claim's `account_id`, and
   drop the `player_map` key from every place row (true, false or
   absent alike). A row already stamped and without the key is not
   rewritten.
3. Drop 0275's `clan_state_player_map` and build `clan_state_place`, the
   same columns with a predicate that is the readers' own and never
   names `player_map`.

Re-running changes nothing. `services/migrate/test/place-one-setting.test.mjs`
runs the file as the runner does, on a scratch database put back to
0275, with a row in every state: stamped by its owner, stamped by a
former owner, unstamped after and before verification, under a claim
with no `verified_at`, under no verified claim, an unreadable `set_at`,
an alt's, a follow's, one already clean, and a non-place row with a
`player_map` key, which is left alone.

**Code.** `placeOwnedBy` is the stamp alone; the unstamped timestamp
fallback is gone. The player map and Near you read every owned place,
and the readers look up each place's claim with a `LATERAL ... LIMIT 1`
so the plan stays an index probe on `claim_one_verified_per_tag` and
`clan_state_place` (`services/migrate/test/player-map-plan.test.mjs`,
query budgets unchanged). Social writes no `player_map`, and
`PUT /api/clan/me/place/player-map` is removed (it answers 404).
`packages/clan/test/social-player-map.test.mjs` went with the behaviour
it tested.

**Deploy.** 0276 runs before the stack flips, so for that minute the old
code serves: its player map and Near you filter on `player_map = 'true'`
and show nobody until the flip. A place saved by the old code in that
window may carry a stray `player_map` key, which the new code ignores.
Vacuum after: `clan_state`.

DECISIONS: "Location is opt-in and a city at most", rewritten.
