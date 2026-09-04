/**
 * Tool taxonomy — the ONE place tools are classified (Jamie, 2026-09-04:
 * "right now they are just one big blob"). Groups follow the
 * cr-agent-api-docs outline (players / battles / clans / river-race /
 * cards) plus two of our own: the live lane and the Elixir MCP service
 * itself. Consumed by the MCP server (tool annotations: grouped titles,
 * read-only hints) and the site docs; a new tool MUST be added here —
 * the registry test enforces it.
 */

export interface ToolClass {
  /** Display group; groups cluster in clients that sort by title. */
  group: string;
  /** Human title without the group prefix. */
  title: string;
  /** MCP readOnlyHint: true unless the tool changes state a user owns. */
  readOnly: boolean;
  /** MCP openWorldHint: true only when the tool reaches OUTSIDE the
   *  recorded corpus (the live CR API lane). */
  openWorld?: boolean;
}

export const TOOL_GROUPS: Record<string, ToolClass> = {
  // Players — profile-shaped views of one tag (docs: players.md).
  get_player: { group: "Players", title: "Player profile", readOnly: true },
  get_player_summary: {
    group: "Players",
    title: "Player summary",
    readOnly: true,
  },
  get_player_timeline: {
    group: "Players",
    title: "Player timeline",
    readOnly: true,
  },
  get_collection: {
    group: "Players",
    title: "Card collection",
    readOnly: true,
  },

  // Battles — the recorded battle corpus and stats over it (docs: models/battles.md).
  query_battles: { group: "Battles", title: "Query battles", readOnly: true },
  get_performance: {
    group: "Battles",
    title: "Performance windows",
    readOnly: true,
  },
  get_deck_performance: {
    group: "Battles",
    title: "Deck performance",
    readOnly: true,
  },
  get_card_performance: {
    group: "Battles",
    title: "Card performance",
    readOnly: true,
  },
  compare_players: {
    group: "Battles",
    title: "Compare players",
    readOnly: true,
  },

  // Clans — roster-shaped views (docs: clans.md).
  get_clan: { group: "Clans", title: "Clan roster", readOnly: true },

  // War — river race, current and historical (docs: models/river-race.md).
  get_war: { group: "War", title: "Current war", readOnly: true },
  get_war_history: { group: "War", title: "War history", readOnly: true },

  // Cards — the global catalog (docs: cards.md).
  get_card_catalog: { group: "Cards", title: "Card catalog", readOnly: true },

  // Live — the ONE lane that spends real CR API budget.
  cr_api_live: {
    group: "Live",
    title: "Live CR API fetch",
    readOnly: true,
    openWorld: true,
  },

  // Elixir MCP — the service itself: your account's claims, how complete
  // the record is, and the feedback channel to the maintainer.
  list_my_players: {
    group: "Elixir MCP",
    title: "My claimed players",
    readOnly: true,
  },
  get_coverage: {
    group: "Elixir MCP",
    title: "Record coverage",
    readOnly: true,
  },
  send_feedback: {
    group: "Elixir MCP",
    title: "Send feedback",
    readOnly: false,
  },
};
