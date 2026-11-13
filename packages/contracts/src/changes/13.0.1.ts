import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.0.1",
  date: "2026-11-13",
  summary: md(
    'Wording only, after JSON API 5.0.0 ("No integrations: Elixir has users and agents"): the server names two kinds of principal, `person` and `agent`.',
    list(
      "`initialize`: the brief and `principal.kind` name a person or an agent; nothing describes an integration door.",
      "A hidden tool's hint says it answers for a person, and that an agent acts for a clan.",
      "`clans_roster`: the per-member roster figures' descriptions say they appear on the web app only; `clans_participation`'s `columns` description names the web app as the place the rows are objects.",
      "`clans_directory`: `docs` points at the clan directory page's Agents section (`/docs/clan-directory#agents`).",
    ),
    "No field or argument changed. The JSON API is unchanged at 5.0.0.",
  ),
} satisfies ChangelogEntry;
