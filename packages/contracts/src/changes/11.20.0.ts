import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.20.0",
  date: "2026-11-12",
  summary: md(
    "A player can highlight one of their battles (#762): a signed-in person whose verified player played it posts it to that player's timeline with their own words, up to 500 characters, on the battle's page. The highlight is the timeline's one single-battle item. Its owner may share it as a link, `/h/<id>`, that opens without an account. Highlighting, editing, sharing and deleting are the person's own, on the website; no MCP tool writes a highlight.",
    list(
      "`elixir_timeline`: a new kind, `battle_highlight` (section `battles`, schema version 1). Its facts: `player_tag`, `name`, `highlight_id`, `words` (as the player typed them) and `battle` (`battle_id`, `url`, `battle_time`, `mode_group`, `game_mode`, `outcome`, `crowns`, `crowns_against`, `trophy_change`, `opponents`), and `share_url` only when the reader's own account posted it and shared it. Its follow-up calls are `battles_query` for the battle and `players_summary` for the player.",
    ),
    "Additive. A deleted highlight leaves the timeline, and its link answers 404. The JSON API carries no timeline, so it is unchanged.",
  ),
} satisfies ChangelogEntry;
