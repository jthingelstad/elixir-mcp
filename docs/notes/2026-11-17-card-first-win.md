# 2026-11-17: The first win with a new card

The owner, 2026-11-17: "In general we were filtering a lot of things that
now a timeline would get value from. I like everything you highlighted
here. Feel free to change elixirs data engine as needed as well." The
third of the batch: `card_first_win`, which 0289 already made room for
(its kind and its typed columns `card_id`, `step`, `battle_id`). MCP
13.9.0; the JSON API is unchanged at 5.1.0. No migration.

## What is told

| Moment | Sentence | When (`at`) | Observed |
| --- | --- | --- | --- |
| `card_first_win/1` | "Pip won with Evo Musketeer for the first time." ("Hero Knight", "Cannoneer") | the winning battle | the read that completed it |

Facts: `card`, `card_id`, `rarity`, `form` (`evolution`, `hero`, or
`null` for the card itself), `tower_troop`, `battle_id`. The website
draws the card's art (its Evo or Hero art for a form), unaltered, as a
form unlock does.

## The rule

`packages/ingest/src/card-first-win.mjs`:

- **Something new**: the record wrote `card_unlocked` (a card or tower
  troop) or `card_form_unlocked` (an Evolution or Hero form). Neither
  fires on a first profile read, so a new follow says nothing.
- **The win**: an own-deck win holding it, played as that form (a
  battle's `evolutionLevel` is the form the slot played as,
  cr-agent-api-docs `players.md`). A plain card counts in any form; a
  tower troop counts in the tower slot. Drawn decks, boat battles and
  duels (no round-0 deck on the row) never count.
- **The first**: the earliest win with it since the profile read before
  the one that showed it (no win can be older: the card was not held);
  once per player, card and form.
- **Fresh**: within 28 days of the read that showed it, and the battle
  reached the record within a day of being played.

Either read can come second. A live battle-log read past its mark checks
its new wins against the player's unlocks (`detectFirstWins`, called
beside the deck switch). A profile read that writes an unlock checks the
wins the log already delivered (`firstWinsForUnlocks`, from
`projectPlayerCards`).

## Where it travels

- **Player and clan timelines, the web feed**: yes; a full moment with
  its card, not a small one (a player rarely gets more than one new
  thing a day).
- **Digest**: no; the unlock itself is the big first (`card_form_unlocked`)
  or counted (`card_unlocked`).
- **Discord**: no; the unlock is already a milestone there, and two posts
  per card would repeat it.
- **Bell, push**: as player moments generally.

## Follow-up from #1111: Master I waits for its battle

Codex on #1111: a Master I finish needs a Ranked battle in the season,
but when the rolled profile was read before the battle log delivered
that battle, the profile read stayed silent and nothing retried.
`rankedFinishAfterBattles` (`snapshots.mjs`) runs on each live
battle-log read: a season filed as Master I, with a Ranked battle inside
it that reached the record after the filing and within 7 days of the
season's end, says the finish then. `rankedSeasonFinished` now checks the
ledger, so it is still said once. The 7 days keep a deploy over seasons
already filed silent.

## What a deploy does

No migration. Unlocks written in the 28 days before the deploy can
complete a first win on a live battle-log read after it, stamped at that
live battle; a win the record already held before the deploy makes any
later win not the first, so nothing old is said.
