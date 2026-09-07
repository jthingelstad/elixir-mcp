/**
 * Tool taxonomy — the ONE place tools are classified (Jamie, 2026-09-04:
 * "right now they are just one big blob"). Groups follow the
 * cr-agent-api-docs outline (players / battles / clans / river-race /
 * cards) plus our own: Collections, the live lane, and the Elixir MCP
 * service itself. Consumed by the MCP server (tool annotations: grouped titles,
 * read-only hints) and the site docs; a new tool MUST be added here —
 * the registry test enforces it.
 */

export const OAUTH_SCOPE = {
  READ: "cr:read",
  RECORDINGS_WRITE: "recordings:write",
  COLLECTIONS_WRITE: "collections:write",
  ACCOUNT_WRITE: "account:write",
  FEEDBACK_WRITE: "feedback:write",
} as const;

export type OAuthScope = (typeof OAUTH_SCOPE)[keyof typeof OAUTH_SCOPE];

/** cr:read is the baseline grant. Mutation grants are additive and never
 *  imply read access on their own. This order is canonical in storage,
 *  token responses, consent, and WWW-Authenticate challenges. */
export const OAUTH_SCOPE_DETAILS: ReadonlyArray<{
  scope: OAuthScope;
  title: string;
  description: string;
}> = [
  {
    scope: OAUTH_SCOPE.READ,
    title: "Read recorded game data",
    description:
      "Profiles, battles, clans, war, collections, and the live-fetch allowance.",
  },
  {
    scope: OAUTH_SCOPE.RECORDINGS_WRITE,
    title: "Change recordings",
    description: "Add or remove players and clans on your account.",
  },
  {
    scope: OAUTH_SCOPE.COLLECTIONS_WRITE,
    title: "Edit collections",
    description: "Change membership in collections you own.",
  },
  {
    scope: OAUTH_SCOPE.ACCOUNT_WRITE,
    title: "Update account preferences",
    description: "Change private nicknames and advance your event cursor.",
  },
  {
    scope: OAUTH_SCOPE.FEEDBACK_WRITE,
    title: "Send feedback",
    description: "File attributed feedback with the maintainer.",
  },
];

export const OAUTH_SCOPES: readonly OAuthScope[] = OAUTH_SCOPE_DETAILS.map(
  ({ scope }) => scope,
);
export const DEFAULT_OAUTH_SCOPE: OAuthScope = OAUTH_SCOPE.READ;

export interface ToolClass {
  /** Display group; groups cluster in clients that sort by title. */
  group: string;
  /** Human title without the group prefix. */
  title: string;
  /** MCP readOnlyHint: true unless the tool changes state a user owns. */
  readOnly: boolean;
  /** OAuth capability required at tools/call. Read tools default to cr:read;
   *  every state-changing tool names its capability explicitly. */
  oauthScope?: OAuthScope;
  /** MCP openWorldHint: true only when the tool reaches OUTSIDE the
   *  recorded corpus (the live CR API lane). */
  openWorld?: boolean;
}

/** The published tree (Jamie, 2026-09-05): tools/list declares in this
 *  group order (then by title) so clients that preserve server order
 *  render the domain structure - never a read-only/read-write split. */
export const GROUP_ORDER = [
  "Elixir MCP",
  "Collections",
  "Battles",
  "Cards",
  "Clans",
  "Live",
  "Players",
  "War",
] as const;

export const TOOL_GROUPS: Record<string, ToolClass> = {
  // Players — profile-shaped views of one tag (docs: players.md).
  players_profile: {
    group: "Players",
    title: "Player profile",
    readOnly: true,
  },
  players_summary: {
    group: "Players",
    title: "Player summary",
    readOnly: true,
  },
  players_timeline: {
    group: "Players",
    title: "Player timeline",
    readOnly: true,
  },
  players_collection: {
    group: "Players",
    title: "Card collection",
    readOnly: true,
  },
  players_search: {
    group: "Players",
    title: "Find player by name",
    readOnly: true,
  },

  // Battles — the recorded battle corpus and stats over it (docs: models/battles.md).
  battles_query: { group: "Battles", title: "Query battles", readOnly: true },
  battles_performance: {
    group: "Battles",
    title: "Performance windows",
    readOnly: true,
  },
  battles_decks: {
    group: "Battles",
    title: "Deck performance",
    readOnly: true,
  },
  battles_cards: {
    group: "Battles",
    title: "Card performance",
    readOnly: true,
  },
  battles_compare: {
    group: "Battles",
    title: "Compare players",
    readOnly: true,
  },
  battles_levels: {
    group: "Battles",
    title: "Level Curve & Pilot Score",
    readOnly: true,
  },
  battles_meta_decks: {
    group: "Battles",
    title: "Meta decks (observed)",
    readOnly: true,
  },
  battles_meta_cards: {
    group: "Battles",
    title: "Meta cards (observed)",
    readOnly: true,
  },
  battles_trends: {
    group: "Battles",
    title: "Segment trends",
    readOnly: true,
  },

  // Clans — roster-shaped views (docs: clans.md).
  clans_roster: { group: "Clans", title: "Clan roster", readOnly: true },

  clans_standings: {
    group: "Clans",
    title: "Clan standings",
    readOnly: true,
  },
  clans_pilot_scores: {
    group: "Clans",
    title: "Clan Pilot Scores",
    readOnly: true,
  },

  // War — river race, current and historical (docs: models/river-race.md).
  war_current: { group: "War", title: "Current war", readOnly: true },
  war_history: { group: "War", title: "War history", readOnly: true },
  war_rivals: { group: "War", title: "Scouting Report", readOnly: true },

  // Collections — curated groupings (owner-published lists + your own).
  collections_browse: {
    group: "Collections",
    title: "Browse collections",
    readOnly: true,
  },
  collections_edit: {
    group: "Collections",
    title: "Edit a collection",
    readOnly: false,
    oauthScope: OAUTH_SCOPE.COLLECTIONS_WRITE,
  },
  collections_get: {
    group: "Collections",
    title: "Collection members",
    readOnly: true,
  },

  // Cards — the global catalog (docs: cards.md).
  cards_catalog: { group: "Cards", title: "Card catalog", readOnly: true },

  // Live — the ONE lane that spends real CR API budget.
  live_fetch: {
    group: "Live",
    title: "Live CR API fetch",
    readOnly: true,
    openWorld: true,
  },

  // Elixir MCP — the service itself: your account's claims, how complete
  // the record is, and the feedback channel to the maintainer.
  elixir_my_players: {
    group: "Elixir MCP",
    title: "My players",
    readOnly: true,
  },
  elixir_coverage: {
    group: "Elixir MCP",
    title: "Record coverage",
    readOnly: true,
  },
  elixir_feedback: {
    group: "Elixir MCP",
    title: "Send feedback",
    readOnly: false,
    oauthScope: OAUTH_SCOPE.FEEDBACK_WRITE,
  },
  elixir_my_feedback: {
    group: "Elixir MCP",
    title: "My feedback",
    readOnly: true,
  },
  elixir_changelog: {
    group: "Elixir MCP",
    title: "Changelog",
    readOnly: true,
  },
  elixir_nickname: {
    group: "Elixir MCP",
    title: "Nicknames",
    readOnly: false,
    oauthScope: OAUTH_SCOPE.ACCOUNT_WRITE,
  },
  elixir_events: {
    group: "Elixir MCP",
    title: "Event feed",
    readOnly: false, // advances your seen-cursor
    oauthScope: OAUTH_SCOPE.ACCOUNT_WRITE,
  },
  elixir_add_player: {
    group: "Elixir MCP",
    title: "Add player",
    readOnly: false,
    oauthScope: OAUTH_SCOPE.RECORDINGS_WRITE,
  },
  elixir_add_clan: {
    group: "Elixir MCP",
    title: "Add clan",
    readOnly: false,
    oauthScope: OAUTH_SCOPE.RECORDINGS_WRITE,
  },
  elixir_data_insights: {
    group: "Elixir MCP",
    title: "Data insights",
    readOnly: true,
  },
  elixir_collectors: {
    group: "Elixir MCP",
    title: "Collectors",
    readOnly: true,
  },
};

export function requiredOAuthScope(toolName: string): OAuthScope | null {
  const tool = TOOL_GROUPS[toolName];
  return tool ? (tool.oauthScope ?? DEFAULT_OAUTH_SCOPE) : null;
}
