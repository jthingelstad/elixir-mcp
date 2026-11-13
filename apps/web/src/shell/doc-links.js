/**
 * The Read more links in the help drawer: one map, keyed the way
 * shell/help.js names a page. A page with a help entry names its own key here.
 */
export const DOC_LINKS = {
  home: [
    "Home",
    [
      ["Get started with Elixir", "/docs/quickstart"],
      ["The timeline", "/docs/timeline"],
      ["Recording and coverage", "/docs/recording"],
      ["Roles and quotas", "/docs/roles"],
    ],
  ],
  "home:find": [
    "Find",
    [
      ["Follow a friend", "/docs/follow-a-friend"],
      ["A player's page", "/docs/player-page"],
      ["Roles and quotas", "/docs/roles"],
    ],
  ],
  clan: [
    "Clan",
    [
      ["Clan actions", "/docs/clan-actions"],
      ["Roles and quotas", "/docs/roles"],
    ],
  ],
  tracking: [
    "What we record for you",
    [
      ["How recording works", "/docs/recording"],
      ["Scopes", "/docs/recording#scope-what-is-actually-polled"],
      ["Roles & slots", "/docs/roles"],
    ],
  ],
  verify: [
    "Proving a claim",
    [
      ["Verify", "/docs/verify"],
      [
        "Claims and relationships",
        "/docs/recording#relationships-primary-nicknames",
      ],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  // The record of one tracked thing: the page with the notify switch on
  // it links to what a notification is.
  "tracking:record": [
    "What we record for you",
    [
      ["How recording works", "/docs/recording"],
      ["Battle activity", "/docs/activity"],
      ["Timeline", "/docs/timeline"],
    ],
  ],
  timeline: [
    "Timeline",
    [
      ["The timeline", "/docs/timeline"],
      ["elixir_timeline", "/docs/tools/timeline#elixir_timeline"],
    ],
  ],
  "activity:requests": [
    "The MCP surface",
    [
      ["Protocol", "/docs/protocol"],
      ["Limits", "/docs/limits"],
      ["Responses", "/docs/responses"],
    ],
  ],
  // The record of one call: what the request and response mean, and
  // how long the body is kept.
  "activity:call": [
    "One call",
    [
      ["Response envelope", "/docs/responses#the-fields"],
      ["Retention", "/docs/limits#retention-windows"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "activity:emails": [
    "The emails Elixir sends",
    [
      ["Email", "/docs/email"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  // The record of one sent email: what it is, and what is counted.
  "activity:email": [
    "One email",
    [
      ["Email", "/docs/email"],
      ["What the mail counts", "/docs/email#what-the-mail-counts"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "activity:events": [
    "Your account log",
    [
      ["Privacy", "/docs/privacy"],
      ["Roles", "/docs/roles"],
    ],
  ],
  usage: [
    "Budgets",
    [
      ["Limits", "/docs/limits"],
      ["Live fetch", "/docs/tools/live"],
      ["Run a collector", "/docs/operators"],
    ],
  ],
  "agent:overview": [
    "Your agent",
    [
      ["Agents", "/docs/agents"],
      ["Roles", "/docs/roles"],
      ["The timeline", "/docs/timeline"],
    ],
  ],
  "agent:tracking": [
    "What an agent follows",
    [
      ["What an agent follows", "/docs/agents#what-an-agent-follows"],
      ["How recording works", "/docs/recording"],
      ["Roles & slots", "/docs/roles"],
    ],
  ],
  "agent:settings": [
    "Running an agent",
    [
      ["Agents", "/docs/agents"],
      ["Connections", "/docs/connections"],
      ["Limits", "/docs/limits"],
    ],
  ],
  "agent:connections": [
    "Connecting as an agent",
    [
      ["Agents", "/docs/agents"],
      ["Connections", "/docs/connections"],
    ],
  ],
  "connections:clients": [
    "Connections",
    [
      ["Connections", "/docs/connections"],
      ["Protocol & auth", "/docs/protocol"],
      ["Scopes", "/docs/connecting#scopes"],
    ],
  ],
  "connections:agents": [
    "Agents",
    [
      ["Agents", "/docs/agents"],
      ["Key lifecycle", "/docs/agents#key-lifecycle"],
      ["Identity map", "/docs/agents#knowing-which-human-is-asking"],
    ],
  ],
  profile: [
    "Your account",
    [
      ["Roles", "/docs/roles"],
      ["Limits", "/docs/limits"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "profile:profile": [
    "Your account",
    [
      ["Roles", "/docs/roles"],
      ["Limits", "/docs/limits"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "profile:seen": [
    "What members see",
    [
      ["What members see", "/docs/your-account#what-members-see"],
      ["Identity map", "/docs/agents#knowing-which-human-is-asking"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "profile:email": [
    "The emails Elixir sends",
    [
      ["Email", "/docs/email"],
      ["What the mail counts", "/docs/email#what-the-mail-counts"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "profile:devices": [
    "Your sessions",
    [
      ["Connections", "/docs/connections"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  feedback: [
    "Feedback",
    [
      ["About the project", "/docs/about"],
      ["elixir_send_feedback", "/docs/tools/help#elixir_send_feedback"],
    ],
  ],
  "status:collectors": [
    "Collectors",
    [
      ["Operators guide", "/docs/operators"],
      ["Architecture", "/docs/architecture#collectors-in-depth"],
    ],
  ],
  // The session clock's cost and loss, per day (2026-09-19).
  "status:efficiency": [
    "Efficiency",
    [
      [
        "How often a subject is fetched",
        "/docs/freshness-and-gaps#how-often-a-subject-is-fetched",
      ],
      ["Completeness", "/docs/freshness-and-gaps#completeness"],
      [
        "Architecture",
        "/docs/architecture#scheduling-how-often-a-player-is-fetched-and-why",
      ],
    ],
  ],
  // One collector's record: the page an operator reads while running one.
  "status:collector": [
    "Running a collector",
    [
      ["Operators guide", "/docs/operators"],
      ["How collectors get work", "/docs/architecture#collectors-in-depth"],
      ["Budgets", "/docs/limits"],
    ],
  ],
  status: [
    "How the service runs",
    [
      ["Architecture", "/docs/architecture"],
      ["Collectors", "/docs/operators"],
      ["Limits", "/docs/limits"],
    ],
  ],
  "admin:accounts": [
    "Accounts & roles",
    [
      ["Roles", "/docs/roles"],
      ["Limits", "/docs/limits"],
    ],
  ],
  "admin:collectors": [
    "Collector fleet",
    [
      ["Operators guide", "/docs/operators"],
      ["Architecture", "/docs/architecture#collectors-in-depth"],
      ["How collectors get work", "/docs/architecture#collectors-in-depth"],
    ],
  ],
  "admin:connections": [
    "Connections",
    [
      ["Connections", "/docs/connections"],
      ["Protocol & auth", "/docs/protocol"],
      ["Roles", "/docs/roles"],
    ],
  ],
  "admin:service-tokens": [
    "Service keys",
    [
      ["Connections", "/docs/connections"],
      ["Protocol & auth", "/docs/protocol"],
    ],
  ],
  "admin:integrations": [
    "Integrations",
    [
      ["Integrations", "/docs/integrations"],
      ["Integration API", "/docs/integrations#provisioning-and-administration"],
    ],
  ],
  "admin:feedback": ["Feedback queue", [["About the project", "/docs/about"]]],
  "admin:emails": [
    "What we send",
    [
      ["Email", "/docs/email"],
      ["What the mail counts", "/docs/email#what-the-mail-counts"],
    ],
  ],
  "admin:discord": [
    "What Elixir posts to Discord",
    [
      ["Timeline cross-post", "/docs/timeline#cross-posting-to-discord"],
      [
        "Actions in Discord",
        "/docs/clan-actions-delivery#actions-in-the-clans-discord",
      ],
      [
        "The clan's activity",
        "/docs/clan-discord#the-clans-activity-in-discord",
      ],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "admin:usage": [
    "Usage across accounts",
    [
      ["Limits", "/docs/limits"],
      ["Architecture", "/docs/architecture"],
    ],
  ],
  "admin:cards": [
    "The archetype vocabulary",
    [
      ["Deck archetypes", "/docs/archetypes"],
      ["Cards", "/docs/cards"],
    ],
  ],
  // Ladder's pages: the section's own page first, then the tool each
  // page reads.
  "ladder:season": [
    "Stats",
    [
      ["Stats", "/docs/ladder"],
      ["battles_performance", "/docs/tools/battles#battles_performance"],
      ["players_summary", "/docs/tools/players#players_summary"],
    ],
  ],
  "ladder:battles": [
    "Stats",
    [
      ["Battles", "/docs/ladder-battles#battles"],
      ["battles_query", "/docs/tools/battles#battles_query"],
    ],
  ],
  "ladder:decks": [
    "Stats",
    [
      ["Decks", "/docs/ladder-decks#decks"],
      ["battles_decks", "/docs/tools/battles#battles_decks"],
    ],
  ],
  "ladder:cards": [
    "Stats",
    [
      ["Cards", "/docs/ladder-cards#cards"],
      ["battles_cards", "/docs/tools/battles#battles_cards"],
      ["battles_opponents", "/docs/tools/battles#battles_opponents"],
    ],
  ],
};
