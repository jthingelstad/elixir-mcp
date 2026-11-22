# The streak's count comes from the tool

2026-11-22. This follows the Codex findings on #1177. That PR had Stats
add up wins and losses in the browser to get the count beside Longest
win streak. Stats' rule is that a number no tool returns needs a tool
change, never a client derivation. The PR also shipped without a What's
new entry.

- `battles_performance` (MCP 15.4.0) now returns `streak_battles`: the
  won and lost battles both streaks read.
- `@elixir-mcp/record/form` carries the field.
- An answer without it gets no streak row.
- Stats shows `streak_battles` beside the row.
