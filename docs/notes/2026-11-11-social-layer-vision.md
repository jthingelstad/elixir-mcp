# 2026-11-11 — Elixir is the missing social layer of Clash Royale

Jamie's product vision interview of 2026-11-11 reset Elixir's direction:
"Elixir is the missing social layer of Clash Royale. Said another way,
Elixir lets you connect with your friends and play together more in
Clash Royale." Earlier rulings had become "a quilt of different things"
for want of a clear vision, and privacy above all had been read more
strictly than meant.

`VISION.md` is rewritten from the interview and is now the root: where a
brief or a DECISIONS line disagrees with it, the vision wins until the
line is rewritten. Every DECISIONS line was sorted keep, change, drop or
ask against it; Jamie answered the asks ("Approved: answer DECISIONS sort
asks A1-A7", A8 "Let's remove the sponsorship stuff for now", A9 the
Discord agent is "an experiment of an LLM using MCP to be a clan agent").

In DECISIONS:

- **Reworded to the vision:** what Elixir is (the social layer, MCP kept
  core, never elite tracking or a deck builder), orientation, timeline
  shape (a highlighted battle is the one single-battle item), signup
  (free, no revenue, a 13-or-older attestation), the record is open
  (readable without signing in; signing in is for writing and engaging),
  what is public about an account (follows, followers, badges public;
  nicknames, Discord profile, email and account machinery private), no
  money taken, follow links, the web as where people follow and
  celebrate, search across every player in Elixir, stored highlights on
  the battle page, a link back from Discord activity stories, gone quiet
  as public game data, Clan state that stays private, the clan directory
  as what saving a policy opts into.
- **New:** location (opt-in, a city at most, a player map), reactions
  (a fixed set, no comments), every player an RSS feed.
- **Kept, with Jamie's answer added:** no recommendations, no game-wide
  statistics, no ratings (as what Elixir is not); no named groups; 50
  slots until a followed player's cost is measured; Clan's five tabs and
  the seven mail kinds until the Design session decides.
- **Dropped:** application controls first, the console switching into
  an agent, the Clan picker heading Clan's rail, leaders landing on
  Actions, and the agent team. The DNS line now says Route 53, and one
  line moved to Operations.

Each brief carries a banner saying the vision and DECISIONS win until it
is rewritten after the Design session; the passages that contradicted
them outright (no public Clan pages, the sponsorship lines) are fixed now.
`AGENTS.md`'s Scope follows. What the new lines need built is tracked in
#752. Docs only: no code, contract or migration changes, and nothing
deploys.
