/**
 * Tool taxonomy — the ONE place tools are classified (Jamie, 2026-09-04:
 * "right now they are just one big blob"). Groups follow the
 * cr-agent-api-docs outline (players / battles / clans / river-race /
 * cards) plus our own. The 1.0.0 review (docs/REVIEW-2026-09-10) split
 * the old "Elixir MCP" bucket - 16 of 47 tools - into what each part is
 * FOR: Account (what you track and who you know), Feed (the push lane),
 * Help (the service explaining itself and the feedback loop) and Service
 * (the fleet and the corpus). A group is a title prefix and a docs family
 * page, never a name prefix, so regrouping breaks nothing.
 *
 * Consumed by the MCP server (tool annotations: grouped titles, read-only
 * and destructive hints) and the site docs; a new tool MUST be added here —
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
    title: "Change what you track",
    description: "Track or stop tracking players and clans on your account.",
  },
  {
    scope: OAUTH_SCOPE.COLLECTIONS_WRITE,
    title: "Edit collections",
    description: "Change membership in collections you own.",
  },
  {
    scope: OAUTH_SCOPE.ACCOUNT_WRITE,
    title: "Update account preferences",
    description: "Change private nicknames and end-user identity mappings.",
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

/** What a client that asks for nothing in particular gets (1.0.0): every
 *  capability, ticked on the consent page where the person can untick any
 *  of them. The old default - cr:read alone - meant the behaviour every
 *  agent is told to perform on its own judgment (file feedback) was
 *  refused on every connection whose client never stepped up, which is
 *  most of them (review Part 3.3; feedback item 30 opens with exactly that). */
export const FULL_OAUTH_SCOPE: string = OAUTH_SCOPES.join(" ");

export interface ToolClass {
  /** Display group; groups cluster in clients that sort by title. */
  group: string;
  /** Human title without the group prefix. */
  title: string;
  /** MCP readOnlyHint: true unless the tool changes state a user owns. */
  readOnly: boolean;
  /** MCP destructiveHint: true when any action of the tool removes or
   *  replaces something a user owns (a claim, a collection's membership). */
  destructive?: boolean;
  /** OAuth capability required at tools/call. Read tools default to cr:read;
   *  every state-changing tool names its capability explicitly. */
  oauthScope?: OAuthScope;
  /** MCP openWorldHint: true when ANY path through the tool reaches
   *  OUTSIDE the recorded corpus (the live CR API lane, including a
   *  `live: true` flag). */
  openWorld?: boolean;
}

/** The published tree (Jamie, 2026-09-05): tools/list declares in this
 *  group order (then by title) so clients that preserve server order
 *  render the domain structure - never a read-only/read-write split.
 *  Account first because "who am I here" precedes every other question;
 *  Help last because it is about the service, not the game. */
export const GROUP_ORDER = [
  "Account",
  "Players",
  "Battles",
  "Cards",
  "Clans",
  "War",
  "Collections",
  "Live",
  "Feed",
  "Service",
  "Help",
] as const;

export const TOOL_GROUPS: Record<string, ToolClass> = {
  // Account — what you track, who you know, what you call people.
  elixir_my_players: {
    group: "Account",
    title: "My players",
    readOnly: true,
  },
  elixir_track_player: {
    group: "Account",
    title: "Track a player",
    readOnly: false,
    destructive: true,
    oauthScope: OAUTH_SCOPE.RECORDINGS_WRITE,
  },
  elixir_track_clan: {
    group: "Account",
    title: "Track a clan",
    readOnly: false,
    destructive: true,
    oauthScope: OAUTH_SCOPE.RECORDINGS_WRITE,
  },
  elixir_nickname: {
    group: "Account",
    title: "Nicknames",
    readOnly: false,
    oauthScope: OAUTH_SCOPE.ACCOUNT_WRITE,
  },
  elixir_identify: {
    group: "Account",
    title: "Who is asking",
    readOnly: false,
    oauthScope: OAUTH_SCOPE.ACCOUNT_WRITE,
  },
  elixir_my_identities: {
    group: "Account",
    title: "People you know",
    readOnly: true,
  },

  // Players — profile-shaped views of one tag (docs: players.md).
  players_profile: {
    group: "Players",
    title: "Player profile",
    readOnly: true,
    openWorld: true,
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
  players_names: {
    group: "Players",
    title: "Resolve tags to names",
    readOnly: true,
  },
  badges_rarity: {
    group: "Players",
    title: "Badge rarity census",
    readOnly: true,
  },
  badges_holders: {
    group: "Players",
    title: "Badge holders",
    readOnly: true,
  },
  // Coverage is about a PLAYER's record, not about the service.
  elixir_coverage: {
    group: "Players",
    title: "Record coverage",
    readOnly: true,
  },

  // Battles — the recorded battle corpus and stats over it (docs: models/battles.md).
  battles_query: {
    group: "Battles",
    title: "Query battles",
    readOnly: true,
    openWorld: true,
  },
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
  battles_opponents: {
    group: "Battles",
    title: "Opponents faced",
    readOnly: true,
  },

  // Cards — the global catalog and what rides with what (docs: cards.md).
  cards_catalog: { group: "Cards", title: "Card catalog", readOnly: true },
  cards_synergy: { group: "Cards", title: "Card synergy", readOnly: true },

  // Clans — roster-shaped views (docs: clans.md).
  clans_roster: {
    group: "Clans",
    title: "Clan roster",
    readOnly: true,
    openWorld: true,
  },
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
  // game_clock needs no subject at all: it is a property of the game, not
  // of anyone playing it. Listed first in the group because "what day is
  // it" precedes "what is my clan doing today".
  game_clock: { group: "War", title: "Game clock", readOnly: true },
  war_current: {
    group: "War",
    title: "Current war",
    readOnly: true,
    openWorld: true,
  },
  war_history: { group: "War", title: "War history", readOnly: true },
  war_rivals: { group: "War", title: "Scouting Report", readOnly: true },

  // Collections — curated groupings (owner-published lists + your own).
  collections_browse: {
    group: "Collections",
    title: "Browse collections",
    readOnly: true,
  },
  collections_get: {
    group: "Collections",
    title: "Collection members",
    readOnly: true,
  },
  collections_edit: {
    group: "Collections",
    title: "Edit a collection",
    readOnly: false,
    // `set` replaces membership wholesale and `remove` can stop a
    // recording; the hint says so instead of pretending every action adds.
    destructive: true,
    oauthScope: OAUTH_SCOPE.COLLECTIONS_WRITE,
  },

  // Live — the ONE lane that spends real CR API budget by raw path.
  live_fetch: {
    group: "Live",
    title: "Live CR API fetch",
    readOnly: true,
    openWorld: true,
  },

  // Feed — the push lane.
  elixir_events: {
    group: "Feed",
    title: "Event feed",
    // Advances the caller's own seen-cursor and nothing else: a bookmark,
    // not account state anyone else can see. Read-only for the same reason
    // it needs only cr:read (feedback #16) - a client that auto-approves
    // read-only tools should not prompt on every poll of the feed.
    readOnly: true,
    oauthScope: OAUTH_SCOPE.READ,
  },

  // Service — the fleet and the corpus.
  elixir_collectors: {
    group: "Service",
    title: "Collectors",
    readOnly: true,
  },
  elixir_data_insights: {
    group: "Service",
    title: "Data insights",
    readOnly: true,
  },

  // Help — the service explaining itself, and the loop back to the maintainer.
  elixir_docs: {
    group: "Help",
    title: "Documentation",
    readOnly: true,
  },
  elixir_examples: {
    group: "Help",
    title: "Examples",
    readOnly: true,
  },
  elixir_updates: {
    group: "Help",
    title: "What's new",
    readOnly: true,
  },
  elixir_changelog: {
    group: "Help",
    title: "Changelog",
    readOnly: true,
  },
  elixir_feedback: {
    group: "Help",
    title: "Send feedback",
    readOnly: false,
    oauthScope: OAUTH_SCOPE.FEEDBACK_WRITE,
  },
  elixir_my_feedback: {
    group: "Help",
    title: "My feedback",
    readOnly: true,
  },
};

export function requiredOAuthScope(toolName: string): OAuthScope | null {
  const tool = TOOL_GROUPS[toolName];
  return tool ? (tool.oauthScope ?? DEFAULT_OAUTH_SCOPE) : null;
}
