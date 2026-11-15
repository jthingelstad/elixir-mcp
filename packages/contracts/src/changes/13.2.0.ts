import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.2.0",
  date: "2026-11-15",
  summary: md(
    "A follower who has not verified a player is now named by the player they claim, marked as not verified, exactly as their player page shows them. Only an account with no player at all is counted without a name.",
    list(
      "`players_follows`: each of `followers.players` carries `verified` (true when the follower's account verified that player, false when it only claims to be them). A new `followers.no_player` counts the followers whose account has no player at all; `followers.unnamed` still counts every follower not listed.",
    ),
    "Additive. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
