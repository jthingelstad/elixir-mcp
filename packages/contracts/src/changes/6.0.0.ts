import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.0.0",
  date: "2026-09-19",
  summary: md(
    "The leaked-elixir counter travels as one object with its caveat on the value (feedback #65 and #66, 2026-09-19). The 3.13.0 note beside the row was served, read and overridden by a consuming agent the morning it shipped, because the number sat beside crowns and trophy_change as if it were an outcome fact; and the differential was populated on duel rows where the shipped spec said null, which supplied the exact number that agent misused. Jamie's call: keep the fields, move them under one object that carries the caveat itself.",
    list(
      "`battles_query` full verbosity: `me.elixir` and every teammate's and opponent's `elixir` is `{ leaked, opponent_leaked, differential, rounds, caveat }` or `null` when the game did not report it. `leaked` is the side's own counter; `opponent_leaked` the one opponent's on `me` of a head-to-head row (null on 2v2 and always null on teammates and opponents); `differential` is `leaked` minus `opponent_leaked` on a single-game head-to-head row and NULL on every duel (each side's counter sums two or three games played on different decks); `rounds` is how many games the counters sum over (null on a duel whose rounds the record never held); `caveat` says why none of it is a skill measure.",
      "The duel note names the field: `elixir.leaked` sums across rounds for both sides.",
      '`verbosity` is accepted on every tool. The instructions call it the one size control without listing tools, so agents sent it everywhere and forty-three tools refused it. A tool with one size now accepts `full` or `compact`, answers in full, echoes `applied.verbosity: "full"` and, when `compact` was asked, says in a note that it had nothing to drop. The eleven tools that declare it are unchanged.',
      "`elixir_send_feedback.message` takes 8,000 characters (was 4,000), and every string-length refusal says how long the value was (`must be at most 8000 characters; it is 9,214`), so nobody trims blind (feedback #64).",
    ),
    "No deprecation window (first-party clients; the 3.0.0, 4.0.0 and 5.0.0 precedent). This is the last major before the adoption freeze: additive minors only from here.",
  ),
  breaking: list(
    "`battles_query`: `me.elixir_leaked` and `me.elixir_leaked_differential` are gone; read `me.elixir.leaked` and `me.elixir.differential`. Teammate and opponent objects' `elixir_leaked` is gone; read `elixir.leaked`. `me.elixir.differential` is null on `riverRaceDuel*` rows where it used to carry the difference of two multi-round sums.",
  ),
} satisfies ChangelogEntry;
