import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.1.0",
  date: "2026-09-25",
  summary: md(
    "The consistency pass (Jamie, 2026-09-25): decisions that had reached one tool now reach every tool they apply to, and the war family's old names go.",
    list(
      "A boat defense is not the member's battle: an enemy attacked the boat and the defense deck answered. It leaves `battles_performance` (and its streak), `battles_compare`, `battles_cards`, `battles_decks`, `battles_trends`, `clans_participation` and the timeline's battle sessions; boat attacks stay.",
      "`battles_performance` without a `mode` and `battles_compare` (which now takes `mode`) serve `modes`, the record split by mode family, and a note says the headline pools them.",
      "`battles_trends` over the corpus counts recorded players only, like every other metric; a battle-stub player is a ghost entry, never a metric.",
      "`clanMate` and unrecognized battle types are casual in every mode group, never ranked or an event.",
      "Battle deck cards carry `form` (`base`, `evolution`, `hero`) beside the API's raw `evolutionLevel`.",
      "`elixir_timeline` takes `season` like every windowed tool, and says where a capped feed stops (`timeline_more_to`).",
      "`war_current`, `war_rivals` and `war_history` drop the `clan_score` and `our_clan_score` aliases (deprecated since 6.19.0; the names are `clan_war_trophies` and `our_clan_war_trophies`), and `war_current` drops `training_today` (`decks_today.day_kind` says it).",
      "On a personal connection `on_behalf_of` is ignored and `elixir_identify` and `elixir_my_identities` are not listed: they map an agent's other people, and a person is themselves. Omitting `clan_tag` means your primary player's clan; the brief names the other clans you track.",
      "`elixir_track_player` refuses to remove your primary player while you track others (`bad_request`): make another player primary first. It used to promote one silently.",
      "`rankings_clan_ladder` always emits `located_elsewhere`; `clans_standings` declares `current_streak` as the object it is; `elixir_collectors` says credits follow points.",
    ),
    "Additive, with removals that are patches under the agent-facing rule (DECISIONS: majors track domain shifts). The JSON API mirrors none of the removed names and moves to 2.1.0 separately.",
  ),
} satisfies ChangelogEntry;
