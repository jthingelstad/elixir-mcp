import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.2.0",
  date: "2026-09-25",
  summary: md(
    "**Attested facts** on the timeline: what a person did in a clan through one of the Elixir family's apps, or what a family app's own game produced for a player, held apart from the game record (which only collectors write) and labelled with who said it, in which app, as what role. Six kinds in the new section `attested`: `departure_classified` (a leader says a departure was a kick or a leave), `role_change_made`, `award_granted` (the clan's own award), `member_away`, `clan_message` (a Clan Leader Message or a clan chat line, which the game's API does not carry) and `personal_record` (Elixir Drop). Each fact's `facts.attested_by` names the app, the player and the role.",
    "Each is shown only to the reader its type allows: a clan fact to anyone whose verified player is in the clan, and a departure's kind or an away to a person whose verified player leads it, never to an agent, so a kick is never narrated; a player fact to whoever has the player on their timeline. The family's apps write them on the JSON API (2.2.0) with the new `clans:attest` capability, which only the family's own apps may ask for. Additive.",
  ),
} satisfies ChangelogEntry;
