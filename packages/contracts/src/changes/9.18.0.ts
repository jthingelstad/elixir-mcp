import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.18.0",
  date: "2026-10-01",
  summary: md(
    "Every `battles_query` row carries `url`, the battle's public page at `https://elixir.poapkings.com/battle/<short id>`: both decks, the towers and how it ended, readable without signing in. It is the link to hand a person for one battle. The short id is the first 12 characters of `battle_id`, longer only where another recorded battle shares them, and `battle_id` also takes the short id or the link itself.",
    "Opponents and teammates carry their own `trophy_change` and `starting_trophies`, which the record always held, and every side carries `clan_name` beside `clan_tag` (`me` gains its `clan_tag`). The JSON API's `GET /players/{tag}/battles` carries the same fields (2.9.0). Additive.",
  ),
} satisfies ChangelogEntry;
