import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.22.0",
  date: "2026-09-23",
  summary: md(
    "The card tools, after the Elixir Gym's first run on them (feedback #102-#108).",
    list(
      "`cards_archetype({cards})` answers an eight-card set, its main use, instead of timing out every time (#104). The exact-set lookup goes through the card index. A timeout hint names `from`/`to` only on tools that take them.",
      "Trophy bands are Trophy Road trophies. A ranked (Path of Legends) observation carries a rating, not trophies, and now sits in no band (#102). Before, the top-1,000 board filled `under_5000`. The season rollups were rebuilt, and a note says so wherever bands and ranked meet.",
      "A form said before a win condition keeps to that form: 'Evo Royal Hogs bridge spam' counts and filters only the Evo form's decks (#105). A bare name matches every form and says so.",
      "`cards_card` `members.played` counts the same population as `season`, so war duels are out (#103). It serves `excluded`, `prior_win_rate` and `prior_basis`, and `insufficient_sample: true` where the shrunk rate is withheld. It no longer claims a corpus prior where it shrinks toward the segment, and a player segment carries freshness (#107).",
      "`cards_card` `history` says when the mode mix moved under the series: ranked went from 18% to 92% of observations between July and September (#106). `cards_synergy` says `anchor.decks` counts observations, not deck identities (#108).",
    ),
    "Additive fields (`excluded`, `prior_win_rate`, `prior_basis`, `insufficient_sample`) and corrected values (bands without ranked, `members.played` without duels, form-scoped archetype names).",
  ),
} satisfies ChangelogEntry;
