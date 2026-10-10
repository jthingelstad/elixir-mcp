import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.7",
  date: "2026-09-24",
  summary: md(
    "From the Elixir Gym's clan-leader journey and its fifth run on the timeline (feedback #263-#274).",
    list(
      "A boat DEFENSE is not the member's war battle: an enemy attacked the clan's boat and the defense deck answered. `war_history`'s days battled and `clans_participation`'s war days leave defenses out, and compact `battles_query` keeps `boat.side` so a sweep can tell attack from defense (#263).",
      "`clans_roster` `first_observed_in_clan` is the member's first stint in the clan, with `rejoined_observed_at` for a member who left and came back; the joined-mid-window note no longer counts a rejoiner's earlier battles in this clan (#264).",
      "`elixir_timeline` member reads name the member on their sessions, serve whole sittings of two or more battles from the day-wide fetch, and never move the read pointer (#265, #269, #270, #271).",
      "On a training day of the week in progress, a clan entry's war fame and place are null: no race day has run (#266). The quiet summary names each member at their own days quiet (#267).",
      "Presence items keep a second absence at the same rung and every return, derived from the battle gaps inside the window (#272). The timeline's `from`/`to` and page say (from, to] and document the member read and the activity counts (#273).",
    ),
    "Additive; war-day counts drop by the defenses they had counted.",
  ),
} satisfies ChangelogEntry;
