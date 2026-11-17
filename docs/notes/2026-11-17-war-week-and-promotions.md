# 2026-11-17 — A followed player's war week and promotions

The owner, 2026-11-17: "In general we were filtering a lot of things that
now a timeline would get value from." Two pieces of clan news were the
clan's alone, so a reader who followed a player and not their clan never
saw them. MCP 13.10.0; the JSON API is unchanged.

## Promotions

- `member_role_changed` is now also built on a player's timeline, from the
  clan's `role_changed` events about them (read through `clan_membership`,
  so any clan the record has them in).
- Promotions only. A demotion stays on the clan's timeline: a step down,
  put in front of a player's friends, is not a moment to cheer.
- The item carries the clan's story id (`ledgerStory("clan_event", …)`),
  so a reader who follows both reads it once; the player copy wins the
  subject, and the line names the clan from its subject ("Pip was
  promoted from Member to Elder in Ember Hall.").
- Pinned by a follower of the player who does not follow the clan
  (`packages/tools/test/timeline-player-clan.test.mjs`).

## The war week

- `war_week_played` (section `war`): the player's `decks_used` and
  `points` from `war_participation` for a week, said at the clan's
  `week_resolved` (`at` and `observed_at` are its window end).
- Weekly only, never a day; points, never fame (DECISIONS "Decks, not
  days"). A week with no deck played says nothing. 16 decks reads "all 16
  war decks" (4 a battle day, 4 battle days, cr-agent-api-docs
  `clans.md`).
- Never on a clan's timeline: `week_resolved` already lists every member.
- Derived at read time: no migration and no ingest change. A deploy says
  nothing about past weeks beyond the reader's window, as `week_resolved`
  itself does.

## Where they travel

| Item | Web feed | MCP | Digest | Discord | Push |
| --- | --- | --- | --- | --- | --- |
| `member_role_changed` (player) | yes, with the clan band | yes | as before: readers with the clan part off | no (clan-only categories) | no |
| `war_week_played` | yes, a small moment (several friends fold into one row) | yes | no | no | no |

Mode: `war_week_played` sits under War. The news check
(`player_clan_moves`) fires for both.

## Left as found

The app writes "Co-leader" (`roleWord`); the voice guide says
"Co-Leader". That predates this change and is app-wide.
