# 2026-11-23 — The written surfaces say Elixir has people, not agents

The public docs, the site, the product briefs, the repository guides and
the skills now describe Elixir once agent accounts are gone ("Elixir has
people, not agents", "One MCP endpoint, `/mcp`", "The old agent accounts
are deleted" in DECISIONS). They are written for the end state, not the
transition: the door, `on_behalf_of`, `elixir_my_identities` and the
schema are removed by the code slice this one ships beside.

- **`/docs/agents` keeps its slug** and becomes "Your own agent": a
  program or assistant you run, signed in as you by OAuth at `/mcp`
  (a headless runtime keeps its refresh token), what `initialize` tells
  it, what it reads and follows on your slots, consuming the timeline
  with a named `reader` and `scope: "home_clan"`, the price of polling,
  Discord (your own Timeline from Settings, a clan's from Run › Discord)
  and feedback. The slug stays because `elixir_docs`, the timeline-tool
  page and the examples link to it, and the page has a job of its own:
  building on Elixir as yourself. Its `consuming-the-timeline` anchor is
  kept; the agent-account sections (create one, key lifecycle, knowing
  which human is asking) are removed outright.
- **`/docs/connections`** becomes "Your connections": one door, every
  connection a person's, and Settings › Connections as it now stands.
- **`clan-directory#agents` keeps its heading**: a tool's docs pointer
  names it. It now means your own agent.
- The roles ladder loses its Agents row; limits loses the agent cap and
  the per-agent hour; protocol, responses, glossary and connecting
  describe one principal kind, `person`, at one door. Service tokens
  stay in Connecting only as the operator's keys for Elixir's own test
  accounts.
- Clan's sharing lists no longer name "the clan's agent", and the clan
  policy page no longer describes the retired Discord bot's war-deck
  check; the war intent is described as part of the policy's public part.
- The two builder examples about agents ("Answer your clanmates",
  "Publish your own stats") are rewritten to the docs as they now stand,
  keeping their keys and numbers; the first is now "Your clan in
  Discord". The examples count stays ten.
- What's new has an unmarked entry: it is breaking only for whoever made
  an agent, and only the owner had one.
- `privacy.md` and `terms.md` still mention agents; they change only
  with Jamie's word and are left for him.
