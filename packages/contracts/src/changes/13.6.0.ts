import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.6.0",
  date: "2026-11-17",
  summary: md(
    'The timeline says when a player takes up a new deck in a mode: "Pip switched to Hog Rider cycle on Trophy Road: 3 battles, 2 wins."',
    list(
      "`elixir_timeline`: a new item kind, `deck_switched` (`battles` section; `facts.mode` the mode group, `ladder`, `ranked` or `war`; `facts.deck` and `facts.prior_deck` the two decks by archetype label; `facts.battles` and `facts.wins` the new deck's run in that mode from its first battle). `at` is the run's third battle, when the switch became real. A switch is a label that names a win condition, played three times in one mode within seven days after fourteen days without it, with three battles on other decks in that mode before it and a record that reaches back that far; one a day per player per mode. Modes are never pooled; event, casual, duel and boat battles and drawn decks never count. Written going forward from a live battle-log read: battles already recorded and late captures never write one. A label is a noun, never a verdict.",
    ),
    "Additive. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
