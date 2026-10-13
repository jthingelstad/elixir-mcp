import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.12.0",
  date: "2026-10-13",
  tools_added: ["clans_my_view"],
  summary: md(
    "A person's own connection can read their own view of their clan in Elixir Clan.",
    list(
      "clans_my_view (new, person-only): for the person's verified player in a clan (optional clan_tag, else the primary's clan), `view` with exactly three things from Clan's last evaluation: `policy` (the summary: set, active, version, members and which parts are on), `standing` (their own standing line) and `actions` (`count` and `waiting`, the Actions they may take as summary lines {number, type, label, subject_name, raised_at, url}; number is null for an Action Clan has not numbered, with a url to the Actions list). `reason` says why standing and actions are null: no_policy, too_few_members or not_evaluated. Never another member's line or clock, never a removal Action (a leader included), never an Action's evidence or log; it never decides or writes. Hidden from agents and integrations; an unverified claim or no verified player in the clan is not_entitled.",
    ),
    "Additive. JSON API 3.2.0 is unchanged; there is no /api/v1 route.",
  ),
} satisfies ChangelogEntry;
