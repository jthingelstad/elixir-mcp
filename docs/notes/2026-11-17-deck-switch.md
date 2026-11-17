# 2026-11-17: The deck switch

The owner, 2026-11-17: "In general we were filtering a lot of things that
now a timeline would get value from. I like everything you highlighted
here. Feel free to change elixirs data engine as needed as well." VISION
names the deck switch as a moment a friend wants to hear. This change
writes it in the record and tells it everywhere the timeline goes. MCP
13.6.0; the JSON API is unchanged at 5.1.0.

## What is told

| Moment | Sentence | When (`at`) | How late |
| --- | --- | --- | --- |
| Deck switch (`deck_switched/1`) | "Pip switched to Hog Rider cycle on Trophy Road: 3 battles, 2 wins." ("in Ranked", "in Clan Wars") | the run's third battle | one battle-log poll |

The website draws the new deck's eight cards under the sentence, as a
session card does. MCP's facts carry the two labels (`deck`,
`prior_deck`), the mode, and the run's battles and wins; never a hash or
eight cards.

## The rule

Written at battle ingest (`packages/ingest/src/deck-switch.mjs`), from the
projector of a live battle-log read:

- **Modes are different games.** Trophy Road (`PvP`), Ranked
  (`pathOfLegend`) and Clan Wars battles (`riverRacePvP`) each keep their
  own runs. Event content, casual play, duels (four decks a battle), boat
  battles and drawn decks (draft, pick, preset) never count.
- **The deck is its label**, and only a label that names a win condition:
  "cycle" alone names nothing a friend would know. Two decks with the
  same label are one deck here; a different tower troop or one swapped
  support card is not a switch.
- **A run** starts at a battle with the label in a mode after 14 days
  without it there. The switch is real at the run's third battle, when
  that comes within 7 days of the first.
- **Something to switch from**: at least 3 battles in that mode with
  other labelled decks in the 14 days before the run; the prior deck is
  the most played label among them. And the record must reach back 14
  days before the run (the player's first recorded battle), so a new
  follow says nothing.
- **One a day per player per mode**: two new decks on one evening are
  one moment, the first. The same run never writes twice (guarded on its
  first battle).

### Silent on deploy

Only a third battle newly delivered past the poll's high-water mark
fires, and only from a live read with a mark (a first log has none, a
replay passes none). A battle played more than a day before it was
recorded (a late capture) never fires. So the battles already in the
record when 13.6.0 deploys write nothing:
`packages/ingest/test/deck-switch.test.mjs` runs the detector over
recorded battles with the mark past them and finds no row, then a live
poll writes exactly one.

## Where it goes

| Surface | Carried |
| --- | --- |
| Timeline (app, MCP, RSS) | yes, a full moment with the deck row |
| Weekly digest | yes (`BIG_FIRST_KINDS`) |
| Discord | no: a deck is a member's own play, not a clan event; the story clause exists if a leader category later wants it |
| Bell, push | no: those are about you (cheers, followers, answers) |

## Data engine

- 0289 (NOT VALID) and 0290 (validate): `player_event` gains
  `mode_group`, `deck_hash`, `prior_deck_hash`, `battles`, `wins` and
  `season_month` (the last for the ranked season finish that follows), and
  the type check takes `deck_switched`, `ranked_season_finished` and
  `card_first_win`. Nullable columns, no rewrite.
- `ingestBattlelog` returns the mark it read (`priorMark`); the
  battle-log projector calls the detector when a live poll past a mark
  delivered battles. One read of the player's eligible battles over 21
  days, and one `min(battle_time)`, per such poll.
- The origin dedupe compares the new columns, so two switches in a day in
  different modes stay two moments.

## Docs

The facts table moved from `timeline-tool` to its own page,
`timeline-kinds`: the timeline page had reached 48,555 characters, past
what one `elixir_docs` result holds, and this batch adds four more kinds.
`timeline-tool` links there from `at` and from its old heading.

## What a deploy does

Nothing at once. From the first live battle-log read after it, a player
whose third battle with a new deck arrives writes one row. Expect a few a
day across followed players; the first hours carry only switches whose
third battle was played in them.

## Follow-up: observed at the read (Codex on #1110)

The row's `window_end` was the third battle, so `evidence_observed_at`
was too, and a poller whose pointer had passed that battle before the
battle-log read delivered it never saw the switch. `window_end` is now
the read's `fetchedAt` (never earlier than the battle); `occurred_at`
stays the third battle.
