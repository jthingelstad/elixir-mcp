/**
 * What's new — the product-updates surface. Newest first. Every
 * user-visible ship appends an entry in the same commit (AGENTS.md).
 */
export const UPDATES = [
  {
    date: "2026-09-05",
    title: "Your activity, your collector, on screen",
    body: "Account gained two pages. Activity shows three views of your own account: every MCP request your agents made (tool, timing, errors - the debugging view), your account's event history, and your notification pipe (with unread rows past your agents' cursor bolded; reading here never marks anything seen for them). Collector shows what your machines have actually done: a 30-day fetch chart per collector, endpoint mix, points, and the running version.",
  },
  {
    date: "2026-09-05",
    title: "The Data section",
    body: "Elixir MCP now shows its work in public. The new Data area carries the corpus dashboard - battles recorded per day, players observed, collector activity, full history - and the rendered contract changelog. The front page touts the live totals, and the public pages are crawlable: real content in the HTML, not just an app shell.",
  },
  {
    date: "2026-09-05",
    title: "The observed meta, and trends for any group",
    body: "Three new intelligence tools, grounded entirely in recorded battles. battles_meta_decks and battles_meta_cards show what's actually being played and winning - across the whole corpus, one clan, one player, or a collection like the pros - with shrunk win rates that never let a lucky 3-0 top the list, distinct-pilot counts, and evolution forms kept separate. battles_trends adds weekly series for the same segments: watch a clan's (or the pros') win rate, volume, and active players move week over week. No tier lists, no opinions - sample sizes ride every number.",
  },
  {
    date: "2026-09-05",
    title: "Added means recorded",
    body: "The model got simpler, at Jamie's direction: adding a player or clan IS recording it - no separate watch toggle, no follow bookmarks, no approval queue. Your tier's slots are the only gate, and the one per-subject setting left is the notification bell: whether that player or clan feeds your agent's event pipe. elixir_add_player and elixir_add_clan replace the watch tools.",
  },
  {
    date: "2026-09-05",
    title: "Watch clans yourself, and one ladder to rule them all",
    body: "Clan watching is now self-serve: add any clan to your account for free, and turn watching on or off yourself - activity or comprehensive - within your tier's slots. No more waiting for approval; the role ladder is the gate. The ladder itself gained its top rung: owner (the super admin) sits above admin, and admins now see the console with day-to-day powers. Docs pages are also directly linkable now (like /docs/roles).",
  },
  {
    date: "2026-09-05",
    title: "The entitlement ladder and the push lane",
    body: "Three ships in one. ROLES: five tiers (member, leader, family, partner, admin) now set recording slots and daily budgets - never what you can read; the full ladder is public under Docs > Roles, and upgrades are self-serve from Account > Overview. SELF-SERVE: the family tier and above create their own collections right on the Collections page. PUSH LANE: agents stop polling - the new elixir_events tool is a per-account event feed (new battles recorded, war week finished, feedback answered, tier changed) with implicit subscriptions: watching something IS subscribing.",
  },
  {
    date: "2026-09-05",
    title: "A navigable web app",
    body: "The site grew faster than its nav, so the nav got rebuilt: four areas - Explore (player, clan & war, collections, collectors), Account (overview, agents, usage, feedback), Docs, and Admin - each with its own page row underneath. Collections are now browsable by everyone under Explore, and the maintainer curates them from a new Admin page. Old links redirect.",
  },
  {
    date: "2026-09-05",
    title: "The feedback loop learns",
    body: "Round two, built from feedback about the feedback system itself: an MCP-visible changelog (elixir_changelog - what shipped since any contract version), machine-readable ship links on responses, a meta hint when a maintainer reply awaits you, and server instructions that ask agents to file friction on their own judgment - your agent reports friction so you don't have to.",
  },
  {
    date: "2026-09-05",
    title: "Open data and Collections",
    body: "Two big ones. All recorded game data is now readable by every account - the same access the game's own public API gives anyone (we add history, not exposure); account data stays private. And Collections arrive: curated groupings of players or clans - starting with a pros list - browsable by everyone, curated by the maintainer for now.",
  },
  {
    date: "2026-09-05",
    title: "First agent feedback, actioned",
    body: "The first feedback ever filed through the MCP write tool asked for three things - and shipped the same night: clans_pilot_scores ranks a whole clan's Pilot Scores in one call (was 18), players_search resolves clanmate names to tags, and battles_levels takes include_curve: false for repeated scoring. The event-mode taxonomy it also asked about had shipped hours earlier. Responses are on each item via elixir_my_feedback.",
  },
  {
    date: "2026-09-05",
    title: "Feedback gets answers",
    body: "Filed feedback now comes full circle: the maintainer can reply, and you (or your agent, via the new elixir_my_feedback tool) see each item's status and response. Nothing gets actioned invisibly - triggered by the first real agent-filed feedback, which deserved better than a void.",
  },
  {
    date: "2026-09-05",
    title: "Event modes, findable",
    body: "KHAOS drafts, Crazy Arena, Showdown - the rotating event modes were recorded all along but hard to discover. battles_performance group_by 'mode' now lists every named mode you've played with its record, and battles_query takes a game_mode filter ('chaos' finds all the Chaos drafts).",
  },
  {
    date: "2026-09-04",
    title: "Level Curve, Pilot Score, Scouting Report",
    body: "Two new intelligence tools, grounded entirely in recorded battles. battles_levels measures what card-level advantage is actually worth (a 66,000-observation curve) and scores any player's Pilot Score - wins your card levels can't explain, with a monthly trend that shows real improvement independent of spending. war_rivals is the Scouting Report: observed war history for every rival clan your brackets have ever contained. No tiers, no opinions - every number ships its sample size.",
  },
  {
    date: "2026-09-04",
    title: "Clan standings",
    body: "New clans_standings tool: every member's recorded win rate over a window, ranked against the clan median - the 'am I above average?' answer, built for agents (including Elixir, the POAP KINGS clan agent, whose stats answers are moving onto Elixir MCP).",
  },
  {
    date: "2026-09-04",
    title: "Clan recording scopes",
    body: "Clan recording now comes in two scopes: activity (the clan itself - roster, war, standings) and comprehensive (all of that plus every member's battles and profile, following the roster as membership changes). Existing recorded clans stay comprehensive.",
  },
  {
    date: "2026-09-04",
    title: "Tools organized by domain",
    body: "Tool names now lead with their domain - players_summary, battles_query, war_current, elixir_feedback - so every client lists them grouped: Players, Battles, Clans, War, Cards, Live, and Elixir MCP itself. The service domain also grew four tools: watch a player, request clan recording, corpus-wide data insights, and the collector ladder. Reconnect to pick up the new names.",
  },
  {
    date: "2026-09-04",
    title: "Round-3 playtest fixes",
    body: "Three fresh agent testers, thirteen fixes: war attendance now counts recorded battles (polls alone undercounted), opponent decks and names appear in battle detail, weekly trends align to real ISO weeks and show trophy-eligible counts, summaries add best-deck and draw counts, and the validation layer rejects forged cursors, empty tags, and out-of-range arguments loudly.",
  },
  {
    date: "2026-09-04",
    title: "The collector gets its own home",
    body: "Running a collector now means cloning one small repo (elixir-mcp-collector on GitHub) instead of the whole server codebase. Existing collectors migrated in place and keep self-updating.",
  },
  {
    date: "2026-09-04",
    title: "Raw history archives to S3",
    body: "Every payload the collectors fetch is now archived durably to S3 the moment it is admitted — the full raw history behind your record is kept forever and stays queryable, while the database keeps only the hot serving set.",
  },
  {
    date: "2026-09-04",
    title: "War tools tell the whole truth",
    body: "Honesty batch from agent playtesting: unknown war-day attendance is now null instead of a false zero, war participants say whether they are still in the clan, the seasons filter applies to member weeks, and comparison windows state plainly that they cover recorded battles only.",
  },
  {
    date: "2026-09-04",
    title: "Service tokens",
    body: "Long-lived API tokens for trusted services — the first step toward elixir-bot consuming Elixir MCP instead of running its own recorder.",
  },
  {
    date: "2026-09-04",
    title: "Collectors earn their keep",
    body: "Running a collector now raises your daily tool-call quota (every 10 fetches = +1 call, up to 4x), and every gateway gets a Clash Royale card as its avatar on the ladder.",
  },
  {
    date: "2026-09-04",
    title: "Documentation",
    body: "A new Docs section: what Elixir MCP is, how privacy and terms work, and the architecture — maintained alongside the code, so it is always current.",
  },
  {
    date: "2026-09-04",
    title: "Explore your data in the browser",
    body: "The new Explore page renders exactly what your agent sees: summary, battles, weekly trend, decks, collection, war, and coverage — every view is a real MCP tool call.",
  },
  {
    date: "2026-09-04",
    title: "Feedback goes straight to the roadmap",
    body: "Send feedback from the dashboard or have your agent call send_feedback — either way it lands on the maintainer's desk attributed to you.",
  },
  {
    date: "2026-09-04",
    title: "Trend, headline, and deck tools",
    body: 'get_performance can return a weekly win-rate series, get_player_summary answers "how am I doing?" in one call, and deck performance gained sorting and share-of-battles.',
  },
  {
    date: "2026-09-04",
    title: "Four months of history imported",
    body: "The elixir-bot archive was replayed into the recorder: battles back to mid-May, war seasons 133-135, and daily snapshots from July.",
  },
  {
    date: "2026-09-03",
    title: "Elixir MCP launches",
    body: "Recording, the MCP server, clan war data, and the gateway fleet — live from day one.",
  },
];
