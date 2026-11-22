# The longest win streak's count

2026-11-22. Codex found this on #1176. `longest_win_streak` reads the
same won and lost battles as `current_streak`, boat battles included.
Its description and the Stats row gave its count as `decided_battles`,
which is PvP only.

We kept the number, so it agrees with `current_streak` and a winning
current streak is never longer than the longest. We corrected the words
around it:

- the tool description (MCP 15.2.1);
- Stats' count beside the row: wins plus losses;
- the Season docs and the DECISIONS line.
