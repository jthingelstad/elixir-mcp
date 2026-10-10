import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.11",
  date: "2026-09-24",
  summary: md(
    "The collections and rankings tools after the Elixir Gym's fourth run on them (feedback #286-#293).",
    list(
      "A clan segment counts only the members Elixir records: a member known only from battle stubs no longer pools into meta, trends, synergy or badge reads, and the response says how many members counted (#286).",
      "`battles_trends` and `cards_synergy` carry the collection segment note the meta tools carry (#287).",
      "`collections_get` says a clan collection is not a segment; read a clan with segment {clan_tag} (#288).",
      "`elixir_my_players` rows carry `clan_name` beside `clan_tag`.",
      "`rankings_timeline`: the floor note says a full board's cutoff also moves when players leave it (#290); a clan at 0 rated_players reads as none of its players on the board, not an empty board (#291); an inverted window is refused like every other windowed tool (#292).",
      "A board location the record does not follow is refused with the recorded locations listed (#293).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
