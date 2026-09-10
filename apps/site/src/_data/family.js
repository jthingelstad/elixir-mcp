/**
 * The POAP KINGS family, and the things we like.
 *
 * Two kinds of group with different bylines and NO cross-selling between
 * them: ours say how they fit the hub, theirs say plainly that they are
 * not connected to us. Recommending someone else’s work in the same
 * voice you use to sell your own is what makes both untrustworthy.
 *
 * Grouped here rather than in the template because Nunjucks has no
 * namespace assignment, so a template cannot carry a running group.
 *
 * Screenshots are real product shots when they exist; a described slot
 * holds the place until then, rather than an illustration standing in
 * for a product nobody has seen.
 */
export default [
  {
    group: "The clan",
    theirs: false,
    projects: [
      {
        group: "The clan",
        key: "kings",
        label: "POAP KINGS",
        icon: "crown",
        kind: "clan",
        state: "live",
        lede: "The clan this all grew out of. 47 members, recorded comprehensively since March — every member's battles, every river race.",
        shot: "Drop a clan-page screenshot",
        points: [
          "Recorded end to end — every member, every river race",
          "Where every Elixir feature gets tried first",
          "Open to players who actually show up",
        ],
        uses: "Recorded comprehensively by Elixir MCP — it is the most complete clan in the corpus.",
        links: [
          ["Visit the clan page", "external"],
          ["Open the clan record", "record"],
        ],
      },
    ],
  },
  {
    group: "Play better",
    theirs: false,
    projects: [
      {
        group: "Play better",
        key: "drop",
        label: "Elixir Drop",
        icon: "gamepad-2",
        kind: "game",
        state: "live",
        lede: "A daily game that sharpens the instincts Clash actually rewards — elixir counting, trade maths, cycle timing. Built for the minutes between matches.",
        shot: "Drop an Elixir Drop screenshot",
        points: [
          "A five-minute habit that sharpens instincts Clash rewards",
          "Reads the record — no Clash key, no scraping",
          "Free to play, nothing to install",
        ],
        uses: "Reads player profiles and the interpreted war clock from Elixir MCP, so it holds no Clash key of its own.",
        links: [
          ["Play Elixir Drop", "external"],
          ["How it reads the hub", "docs"],
        ],
      },
    ],
  },
  {
    group: "Agents",
    theirs: false,
    projects: [
      {
        group: "Agents",
        key: "agent",
        label: "Elixir Agent",
        icon: "bot",
        kind: "agent",
        state: "live",
        lede: "The clan agent for POAP KINGS. It answers members about their own record — fame, attacks, decks, trophies — in the clan's own Discord.",
        shot: "Drop a Discord screenshot of Elixir Agent answering",
        points: [
          "Answers members in the clan's own Discord",
          "Knows the clan's history — never your account",
          "Runs on its own key, revocable in one click",
        ],
        uses: "A first-class agent principal: its own door, its own key, its own event feed.",
        links: [
          ["See how agents work", "docs"],
          ["Answer your clanmates", "case"],
        ],
      },
      {
        key: "discord",
        label: "Discord bot",
        icon: "message-square",
        kind: "bot",
        state: "beta",
        lede: "Stand up an agent for your own clan in minutes. Invite the bot, paste your clan tag, approve it in the console — it maps each Discord member to their player tag the first time they ask.",
        shot: "Drop the bot's invite or setup screen",
        points: [
          "Live in minutes: invite, paste your clan tag, approve",
          "No hosting and no code to write",
          "Maps each member the first time they ask",
        ],
        uses: "Creates and runs an agent principal on your behalf; every call is charged to your daily budget.",
        links: [
          ["Add it to your server", "external"],
          ["Create an agent", "console"],
        ],
      },
    ],
  },
  {
    group: "For builders",
    theirs: false,
    projects: [
      {
        group: "For builders",
        key: "crdocs",
        label: "CR Agent-first API docs",
        icon: "book-open",
        kind: "docs",
        state: "live",
        lede: "The Clash Royale API, documented for agents rather than for humans reading a portal — every endpoint, field and quirk in a shape a model can actually consume.",
        shot: "Drop a screenshot of the API docs",
        points: [
          "Written for models, not for a browser",
          "Every endpoint, field and quirk in one place",
          "Free, public, and kept current",
        ],
        uses: "Independent of the hub — it documents Supercell's API, which is what Elixir MCP records from.",
        links: [
          ["Read the docs", "external"],
          ["Our own tool reference", "docs"],
        ],
      },
      {
        key: "mcp",
        label: "Elixir MCP",
        icon: "database",
        kind: "hub",
        state: "live",
        here: true,
        lede: "The hub. It records Clash Royale history and serves it to agents over MCP — and everything above reads from it rather than from each other.",
        shot: "Drop a screenshot of the console or a transcript",
        points: [
          "History for the players and clans people ask us to record",
          "One hub — every product above reads from it",
          "Your own agent, in your own client",
        ],
        uses: "You are here.",
        links: [
          ["The corpus", "data"],
          ["Use cases", "cases"],
        ],
      },
    ],
  },
  {
    group: "Things we like",
    theirs: true,
    projects: [
      {
        group: "Things we like",
        key: "royaledle",
        label: "Royaledle",
        icon: "puzzle",
        kind: "daily game",
        state: "live",
        theirs: true,
        lede: "A daily Clash guessing game — one card, six tries, everybody gets the same puzzle. The good kind of five-minute habit, and the reason half the clan chat is spoiler-tagged every morning.",
        shot: "Drop a Royaledle screenshot",
        points: [
          "One puzzle a day, the same for everyone",
          "Perfect clan-chat fodder",
          "No account, nothing to install",
        ],
        uses: "No connection to Elixir MCP — we just play it.",
        links: [["royaledle.org", "external"]],
      },
      {
        key: "royaleapi",
        label: "RoyaleAPI",
        icon: "chart-column",
        kind: "stats site",
        state: "live",
        theirs: true,
        lede: "The reference Clash Royale stats site, and the one everybody means when they say “go look it up”. Deck stats, player profiles, tournament coverage — the standard we measure our own numbers against.",
        shot: "Drop a RoyaleAPI screenshot",
        points: [
          "The reference for current meta, decks and ladder",
          "Deep player and tournament coverage",
          "Where we sanity-check our own numbers",
        ],
        uses: "Independent of us. Complementary, not competing: they answer what is happening now, we answer what happened over months.",
        links: [["royaleapi.com", "external"]],
      },
    ],
  },
];
