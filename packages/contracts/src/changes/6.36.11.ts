import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.11",
  date: "2026-09-23",
  summary: md(
    "The collection tools after the Elixir Gym's third run on them (feedback #201-#203), and the card tools after its fourth (feedback #204-#207).",
    list(
      "`years_played` null is described as what it almost always is: a read profile with no YearsPlayed badge, which the game first awards after about a year of play, so an account under a year old. It had said the profile was not read yet, which was false for every null checked (#201). `players_profile` declares the same.",
      "A clan collection passed as a segment `collection` is refused as an argument error that says it is a clan collection and gives the route (one `segment { clan_tag }` per clan), not the not_found an unknown slug gets (#202).",
      "`cards_card` on mode tournament says why `by_band` is empty (a tournament row has no trophy band) instead of claiming the rollup is not filled; `battles_meta_cards` and `battles_meta_decks` carry the band note whenever `trophy_band` meets a mode other than ladder (#204).",
      "`card.first_seen_in_catalog` says, when it holds the day Elixir began storing the catalog (2026-09-10), that it is not the card's release: every card present then carries it (#205).",
      "`cards_synergy` over one player carries the player's `freshness_seconds` and `recorded_since`, as `cards_card` does (#206).",
    ),
    "Additive; one refusal changes class from subject to input.",
  ),
} satisfies ChangelogEntry;
