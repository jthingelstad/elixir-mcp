import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.31.0",
  date: "2026-09-08",
  summary:
    "Every tier now tracks 50 players, up from 3-25 - one comprehensive clan watch already records about that many, and recordings are shared, so a clanmate of a clan already being captured costs nothing to add. Your connection now tells you who you are. The opening instructions name your primary player, your alts, the friends and players you watch, and your clan - so 'how am I doing' needs no lookup, and omitting player_tag has always meant you. Agents, which serve many humans through one connection, can learn who is asking: pass on_behalf_of with an id from your own surface (discord:, signal:, anything) and map it once with elixir_identify. Players you add now carry a relationship - primary, alt, friend or watching.",
  tools_added: ["elixir_identify", "elixir_my_identities"],
} satisfies ChangelogEntry;
