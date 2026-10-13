import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.11.4",
  date: "2026-10-13",
  summary: md(
    "A verified player is its owner's alone: no other account may claim it as itself. A primary or alt on a tag another account has verified is refused, and when a tag is verified, every other account's primary or alt claim on it ends, with an account item on that account's timeline.",
    list(
      "elixir_track_player: add with relationship primary or alt (or a first player with no relationship) on a tag another account has verified fails `not_entitled`, with the Verify page's answer: if that player is yours, sign in to the account that verified it, or tell us. friend and watching are not refused, and a first player named either is added as that and not made the primary.",
      "elixir_timeline: `account_claim_ended` (facts `player_tag`, `reason` verified_elsewhere, `was_primary`, `relationship`) says a claim of yours ended because another account verified the player; `account_claim_refused` says a signup tag was not added for the same reason. Neither names the other account.",
      "The identity brief: a person who tracks players but has no primary (one ended this way) is told so, instead of being told they have no player.",
    ),
    "A correction: shapes are unchanged. JSON API 3.2.0 is unchanged: `POST /me/players` runs the same tool and fails with the same Problem.",
  ),
} satisfies ChangelogEntry;
