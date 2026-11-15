import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.3.0",
  date: "2026-11-15",
  summary: md(
    "Linked follows: a Verified player's follow is its account's follow. Following a player another account has verified also follows that account and its other Verified players; unfollowing one of them ends the whole link. Claimed and Imported players stay player-only.",
    list(
      "`elixir_follow_player`: an add of a Verified player carries `linked` (`followed`, the account's other players now followed, and `skipped`, each `{player_tag, reason}` the follow could not take: `no_free_slot` or `no_own_player`). A remove that ended a link carries `unfollowed`, every player it stopped following.",
    ),
    "Additive. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
