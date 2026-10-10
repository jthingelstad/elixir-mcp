import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.17.0",
  date: "2026-09-29",
  summary: md(
    "`clans_roster` carries `required_trophies` and `donations_per_week`, the clan's own figures from the same newest roster read as its scores, at both verbosities.",
    "The JSON API (2.8.0) and the console also give each member `donations_received_this_week`, `clan_rank`, `previous_clan_rank`, `arena` and `favorite_card_id`; the agent's roster leaves those out, because a full clan's read is already close to the response cap. The JSON API also gains `GET /clans/{tag}/war-history`, the `war_history` result for an integration. Additive.",
  ),
} satisfies ChangelogEntry;
