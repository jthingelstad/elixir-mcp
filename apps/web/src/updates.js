/**
 * What's new — the product-updates surface. Newest first. Every
 * user-visible ship appends an entry in the same commit (AGENTS.md).
 */
export const UPDATES = [
  {
    date: "2026-09-04",
    title: "Tools get a taxonomy",
    body: "The 17 tools are now classified - Players, Battles, Clans, War, Cards, Live, and the Elixir MCP service itself - mirroring the Clash Royale API docs' outline. Groups ride each tool's title, read-only tools declare themselves, and the new Tools docs page lists everything.",
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
