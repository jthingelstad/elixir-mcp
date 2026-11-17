import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.11.0",
  date: "2026-11-17",
  summary: md(
    "A highlight is now a post with a battle attached. People post about a battle from its page, words optional, and every highlight posted before is one of those posts, under the same item `id`, with its cheers and comments.",
    list(
      "`elixir_timeline`: a `battle_highlight` item (schema version 2) gains `facts.post_id`, the post's id. `facts.highlight_id` carries the same value from now on, for every item, old ones included: a decimal string where it was a UUID. The item `id`, `at`, `facts.words`, `facts.battle` and `share_url` are as before. The sentence says `posted about a 3-1 win against …` where it said `highlighted a 3-1 win against …`.",
      "`players_highlights`: unchanged in shape; it answers with the player's posts about their battles, which are every highlight they posted and every one they post now. Posts about no battle are never in it.",
    ),
    "An addition. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
