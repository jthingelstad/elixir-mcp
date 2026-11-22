# More numbers in Stats' comparisons

2026-11-22. A clan King said the "This week vs your last 4" and "This
season vs last" panels were the best part of Stats. Jamie asked which
more stats to add.

## What changed

- `battles_performance` (MCP 15.2.0) adds four fields to `window`,
  `compare_window`, `before` and `after`: `close_wins` and `close_losses`
  (single-game head-to-head battles won or lost by exactly one crown),
  `three_crowned_against_rate` (over `head_to_head_battles`) and
  `longest_win_streak` (gaps and islands over the window's decided
  battles, in battle order). Duels and boat battles never count, as for
  the three-crown rate.
- `@elixir-mcp/record/form` carries them: three-crowned against shares
  the three-crown rate's head-to-head minimum, and each number shows only
  when both sides carry it, so an answer from before 15.2.0 draws the
  old table.
- Stats draws three more rows in each Form table: Close games (one
  crown), Three-crowned against, Longest win streak.

## Why these

They are facts a player recognises from the game, they read as a fair
comparison between two stretches of one mode, and each sits beside a
count. Close games answer "am I losing the tight ones?" without a verdict.

## Left out

- Average elixir leaked: the tool's own description says it is not a
  skill measure, and a comparison table would read it as one.
- A record against opponents' archetypes: Matchup expectations is
  declined in DECISIONS.

## Product questions

- Is one crown the right line for "close"? (engineering default; a
  tiebreaker-only game is a one-crown game too.)
- The longest streak counts only inside the window, so a streak running
  in from the week before is cut. The docs say so.
