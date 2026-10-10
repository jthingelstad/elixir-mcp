import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.27.0",
  date: "2026-09-07",
  summary:
    "War days now follow the 10:00 UTC POLICY reset for every clan. Clash Royale matches clans into races of five as matchmaking fills, so each clan's real period start drifts off that hour by its own amount; Elixir MCP is multi-clan and cannot honour every clan's start while still having war_day mean one comparable window. Boundaries are therefore identical across clans, and a replay assigns the same war day the live run did. war_current's period block gains period_start_nominal and observed_offset_minutes: started_observed_at is still reported, so a single-clan consumer can correct for its own clan's drift. Consequence stated rather than hidden: battles played between a clan's real start and the policy hour are attributed to the previous policy day. decks_today gains over_cap, which names anyone observed with more than four decks in a policy day - the direct measurement of that cost, which the display cap used to swallow.",
} satisfies ChangelogEntry;
