---
slug: timeline-kinds
title: "Timeline kinds"
description: "Every elixir_timeline item kind: its schema version, what its at means, and the facts keys a consumer branches on."
section: protocol
order: 6
navTitle: "Timeline kinds"
icon: list
lede: "Each timeline kind's facts and timing, for a consumer that branches on them."
---

# Timeline kinds

The items themselves, their windows and pointers are on
[The timeline tool](/docs/timeline-tool#items).

`text` is written from `facts`, and `facts` is what a consumer branches on.
Each kind is versioned on its own (`schema` on the item). The keys below
are on every item of the kind (a value may be `null` where the row says
so); keys in brackets appear only when the record holds them. Every item
about a player, a member's moment on a clan's timeline included, carries
`player_tag` and `name` (the in-game name).

| kind | version | `at` is | `facts` |
|---|---|---|---|
| `battle_session` | 5 | the session's first battle; `sort_at` is its last | `player_tag`, `name`, `started_at`, `ended_at`, `duration_s`, `battles`, `won`, `lost`, `drawn`, `by_mode` (battles per mode group), `trophy_net` (the session's Trophy Road net), `trophy_net_peak` (its value furthest from 0), `trophy_net_by_mode` (each trophy mode's net; a challenge's +1 a win is its counter, and Ranked's +30 a win below Ultimate Champion moves no standing: both are left out), `won_in_a_row`, `open`, `decks` (up to three `{ label, battles }`, by archetype label; a deck the player did not bring, from a draft, a pick or a preset, has none), `events` (`{ event_tag, name, battles, won, lost, game_mode, drawn_decks?, run_wins? }` per event or challenge played: `name` is the event's title on one line, `game_mode` its ruleset, `drawn_decks` true when its decks were drafted or handed out, `run_wins` the most wins its challenge counter reached in the session, absent for an event with no counter), [`ranked`] (the session's Ranked battles: `{ battles, won, lost, league_from, league_from_name, league_to, league_to_name, promotions, rating? }`; a league is the one a battle started in; `promotions[]` is each climb the session's own battles show, `{ from, to, from_name, to_name, battle_id, at }`, the last win at the lower league; `rating` is `{ from, to }` over its Ultimate Champion battles), [`together`] (up to three players the record follows met in the session, `{ player_tag, name, with, against }`: 2v2 partners and friendly or clanmate opponents, by battles; a player the record does not follow is never named), [`three_crown_wins`] (wins that took the King Tower; never a duel's summed games or a boat battle), [`overtime_wins`] (wins the tiebreaker decided at the end of overtime, crowns level: a win by a tower in overtime looks like any other win in the log and is not counted) |
| `session_standout` | 6 | the battle that crossed the first new rung; `sort_at` is the session's last battle | the session's keys, plus `crossed` (every rung passed, as `won_in_a_row>=5`, `trophy_net>=300`, `battles>=20`; a trophy rung's label names its band either way, so read the crossing's signed `value` for the direction), `newly` (the rungs this window learned) and `crossings` (each rung's `{ rung, key, threshold, value, at, battle_id }`: the value at the battle that crossed it, signed, so a trophy rung crossed going down reads negative, and that battle), [`teammate`] (`{ player_tag, name, battles }`, the 2v2 partner: tell a pair's sessions once), [`best_win`] (the win over the highest-rated opponent, the battle shape below plus `mode`; only a win whose trophies are a standing is rated, never a challenge's win counter) |
| `battle_highlight` | 1 | when the player posted it; the battle's own time is `battle.battle_time` | `player_tag`, `name`, `highlight_id`, `words` (as the player wrote them, up to 500 characters; may be empty), `battle` (`{ battle_id, url, battle_time, mode_group, game_mode, outcome, crowns, crowns_against, trophy_change, opponents }`, each opponent `{ player_tag, name, starting_trophies }`), [`share_url`] (the post's public link, `/h/<id>`, on the owner's own reads once shared) |
| `badge_earned` | 3 | the profile read that saw the latest level the item holds | `player_tag`, `name`, `badge`, `badge_label`, [`level`, `max_level`, `prior_level`, `badges`, `badge_count`] |
| `legendary_badge_earned` | 2 | the profile read that saw it | `player_tag`, `name`, `badge`, `badge_label` |
| `arena_changed` | 2 | the promoting battle when `promoted_by` is there, else the read that saw the move | `player_tag`, `name`, `from`, `to` (arena ids), `from_name`, `to_name`, [`promoted_by`] |
| `ranked_promotion` | 2 | the promoting battle when `promoted_by` is there, else the read that saw the league | `player_tag`, `name`, `from`, `to` (league numbers), `from_name`, `to_name`, [`promoted_by`] |
| `best_trophies_band` | 2 | the crossing battle when `crossed_by` is there, else the read that saw the best | `player_tag`, `name`, `best`, [`band`, `crossed_by`] |
| `collection_level_step` | 2 | the profile read that saw the level | `player_tag`, `name`, `level`, `step` |
| `career_wins_step` | 2 | the crossing win when `crossed_by` is there, else the read that saw the count | `player_tag`, `name`, `wins`, [`step`, `crossed_by`] |
| `card_unlocked` | 2 | the profile read that saw the card | `player_tag`, `name`, `card`, `card_id`, `rarity` |
| `card_maxed` | 1 | the profile read that saw the card at its top level | `player_tag`, `name`, `card`, `card_id`, `rarity`, `level` |
| `king_tower_leveled` | 1 | the profile read that saw the level | `player_tag`, `name`, `level`, `prior_level` |
| `challenge_best_run` | 1 | the profile read that saw the new best | `player_tag`, `name`, `best`, `best_before` |
| `twelve_win_run` | 1 | the profile read that saw the run counted | `player_tag`, `name`, `badge`, `badge_label`, `challenge`, `runs`, `runs_before`, [`level`, `prior_level`] |
| `deck_switched` | 1 | the run's third battle, when the switch became real | `player_tag`, `name`, `mode`, `deck`, `prior_deck`, `battles`, `wins` |
| `card_form_unlocked` | 2 | the profile read that saw the form (it happened no later) | `player_tag`, `name`, `card`, `card_id`, `rarity`, `form` (`evolution` or `hero`) |
| `clan_joined` | 2 | the roster read that saw the join | `player_tag`, `name`, `kind`, `clan_tag`, `clan_name`, `at` |
| `clan_left` | 2 | the roster read that saw the departure | `player_tag`, `name`, `kind`, `clan_tag`, `clan_name`, `role`, `at` |
| `member_joined` | 1 | the roster read that saw the join | `player_tag`, `name`, `role`, `roster_size_before`, `roster_size_after` |
| `member_left` | 1 | the roster read that saw the departure | `player_tag`, `name`, `role_at_departure`, `joined_observed_at`, `roster_size_before`, `roster_size_after` |
| `member_role_changed` | 1 | the roster read that saw the new role | `player_tag`, `name`, `role_before`, `role_after`, `direction`, `roster_size_before`, `roster_size_after` |
| `bracket_observed` | 1 | the record's first sight of the week | `season_id`, `section_index`, `is_colosseum`, `rivals[]` (`tag`, `name`, `recorded`) |
| `race_finished` | 1 | the finish, when the race log gives it, else the read that saw it | `season_id`, `section_index`, `fame`, `finish_time` |
| `week_resolved` | 2 | the read that saw the week close | `season_id`, `section_index`, `is_colosseum`, `fame`, `rank`, `trophy_change`, `members` (`player_tag`, `name`, `decks_used`, `points`, most points first; `text` names the top three) |
| `quiet_crossed` | 2 | the last battle plus the rung's days | `player_tag`, `name`, `rung` (5, 10 or 20), `days_quiet`, `days_since_poll`, [`role` on a clan's timeline] |
| `returned` | 2 | the battle that ended the absence | `player_tag`, `name`, `after_days` |
| `account` | 2 | the first event of the burst | other `account_*` kinds: the event's detail (a subject tag, a role), `count` (events in the burst), `apps` (apps named) |
| `account_feedback_responded` | 3 | the answer | `feedback_id`, `status`, `response` (`null` on a pre-11.13.0 answer since replaced), `shipped_in`, `area`, `category`, `message` (600 characters), `filed_at`, `answered_at`, `count` (1), `apps` |
| `departure_classified` | 1 | when it happened, as attested; selected by when Elixir recorded it | `kind`, [`left_at`], `player_tag`, `name`, `attested_by`, `visibility`; `role_at_departure` when known |
| `role_change_made` | 1 | as above | `from`, `to`, `player_tag`, `name`, `attested_by`, `visibility` |
| `award_granted` | 1 | as above | `award`, `season_id`, [`place`], `player_tag`, `name`, `attested_by`, `visibility` |
| `award_standing` | 1 | as above | `award`, `award_id`, `season_id`, `place`, `value`, `unit`, `as_of`, [`previous_player_tag`], `player_tag`, `name`, `attested_by`, `visibility` |
| `member_away` | 1 | as above | [`until`], `player_tag`, `name`, `attested_by`, `visibility` |
| `clan_message` | 1 | as above | `channel`, [`title`], `body`, `attested_by`, `visibility` |
| `personal_record` | 2 | as above | `game`, `score`, [`previous_best`], `player_tag`, `name`, `attested_by`, `visibility` |

A `promoted_by`, `crossed_by` or `best_win` battle is the one shape described above
(`battle_id`, `battle_time`, `type`, `opponent` or `opponents`, `crowns`,
`crowns_against`, `trophy_change`, `trophies_after`, and `arena_floor` on the
arena moment).

A profile-derived moment (arena, ranked league, best band, collection
level, badges, cards and their forms) is written once, by the first profile poll that
sees it; later polls the same day rewrite the day's reading and never
the moment. An arena move is polled for as soon as the player's own
battles vouch for it (see [Recording](/docs/recording/), the profile
arena request), so it arrives within the battle log's cadence rather
than the profile's.

Trophy Road arenas have floors: reaching the floor puts a player in the
arena, and a loss never takes them below it again (a loss on the floor is
reported by the game with no trophy change; a loss just above it is
clamped). The last floor, 14,000, is where Trophy Road ends: a player
there stays there whatever they lose, and the seasonal road beyond it
resets each season. The promotion is therefore the win whose result first reaches
the floor, whoever it was against - near a gate that is usually someone
already standing on it, because matchmaking pairs a climber with the
players sitting on the floor above, but it need not be. The floor is read
from the record (the lowest trophies any reading has shown in that arena,
or this player's own gated loss), never assumed.
