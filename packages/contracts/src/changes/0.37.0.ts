import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.37.0",
  date: "2026-09-08",
  summary:
    "Your connection now identifies itself as data, not only as prose. initialize has always said who you are connected as inside the instructions - 'YOU ACT FOR POAP KINGS' - which suits the model reading it and not the program hosting it, so a client wanting to refuse to boot on the wrong token had to pattern-match English that gets reworded whenever the wording is tuned. The same facts now ride in _meta: kind (person, agent or integration) and subject (the clan an agent acts for, the player a person is, or null). Subject is always present, so an agent misconfigured with no clan is detectable at startup instead of showing up later as an empty answer. It reports the connection you hold and grants nothing; rights are still derived server-side on every call. Reported by the author of the Elixir MCP Discord app.",
} satisfies ChangelogEntry;
