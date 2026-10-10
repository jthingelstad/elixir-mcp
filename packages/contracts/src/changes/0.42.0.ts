import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.42.0",
  date: "2026-09-09",
  summary:
    "The game's own lastSeen is captured and served instead of discarded. Clash Royale exposes it only inside a clan's memberList - /players/{tag} does not carry it - so it was obtainable on every roster poll and thrown away, and every un-stored poll was gone for good. players_profile now returns last_seen_in_game and clans_roster returns it per member, both null until a polled clan roster carried that player. Read it as when the PLAYER was last active, which is a different fact from last_recorded_battle (only moves when a battle was captured) and from this recorder's own poll times. It is also the predicate the game itself uses: verified against a live payload, the members missing from a clan's currentriverrace participants were exactly those whose lastSeen predated the race start, while joining late did not exclude anyone and neither did not battling - so a member absent from war_current.participants with a stale last_seen_in_game is dormant rather than dropped. Backfill is not possible; the column fills from the next roster poll onward.",
} satisfies ChangelogEntry;
