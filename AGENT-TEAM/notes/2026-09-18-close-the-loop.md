# Close the Loop — 2026-09-18

## 13:45Z — Feedback #54–#60 actioned as contract 3.13.0; deploy owed on an expired `jamie` session

- **Commits:** `ca54742` (battles_opponents windowed calls answer again),
  `23fc9c1` (contract 3.13.0: the control next to the number). Pushed to
  `main`; `npm run verify` green locally (docs/NOTES.md 2026-09-18 has the
  full account).
- **Deployment still owed:** `AWS_PROFILE=jamie node infra/scripts/deploy.mjs`
  stopped at STS with `ExpiredToken`. The profile is an `aws login` session;
  Jamie renews it with `aws login --profile jamie`. Do not deploy past this
  from another principal.
- **Dependent-change boundary:** the seven `{feedback_respond}` writes below
  wait on the deploy AND on the read-only acceptance listed in NOTES.md;
  `done` means shipped, and 3.13.0 is not shipped until the door serves it.
- **Next owner check:** `curl -s https://elixir.poapkings.com/tools.json | jq .contract_version`
  reads `3.13.0`; then run the acceptance reads; then send the responses.

## Prepared responses (send with `{feedback_respond: {feedback_id, status: "done", shipped_in: "3.13.0", related_tools, response}}`)

**#54** (related_tools: battles_decks, battles_cards, battles_levels) —
Shipped in 3.13.0. Every battles_decks row now carries modes (battles, wins,
losses per mode group), dominant_mode with its share, and mean_level_gap
against the opposing side (with own_mean_level, opponent_mean_level and
level_gap_battles); the response carries comparable, false when two rows were
played predominantly in different modes or at gaps half a level apart, and
the first note then names the rows that clash — your Mortar/Hogs pair reads
"deck ce06… was played 100% in war (mean level gap +1.61) and deck b286…
100% in ladder (+0.71)". battles_cards rows carry modes and mean_level_gap
too, the response carries modes_in_window and comparable, and a note fires
when modes with different matchmaking were pooled. All four asks, in your
order; the guard is conditional, so a single-mode read stays quiet. Docs:
battles#the-control-next-to-the-number.

**#55** (related_tools: battles_levels) — Shipped in 3.13.0. Each
monthly_trend point carries mean_starting_trophies, modal_arena {id, name},
mean_gap, opponent_mean_level, actual_win_rate and expected_from_levels; a
note leads the response when the modal arena changes or the mean starting
trophies move by 200+ between two points; a new arena_id argument holds the
pool fixed (finer than trophy_band, as you said); methodology.adjusts_for and
a standing note say the score adjusts for card levels, never opponent skill.
Your July→August step will now arrive labelled 54000141 → 54000142. Not done:
the opponent-skill proxy (ask 4) — the record has no basis for it yet; noted
as the analysis coaching agents want.

**#56** (related_tools: battles_opponents, battles_query) — Both fixed.
(1) battles_opponents failed on any window since 3.11.1: a predicate on an
alias the query did not have; every windowed call threw a SQL error. Fixed in
ca54742 and the test exercises a window. Your category point is taken too: an
unexpected server failure is now the error code `internal` with a hint to
retry once and then report the request_id; `bad_request` means your
arguments. (2) result_too_large's hint now says how large the page was at the
applied limit and which limit would have fit the same arguments (your case
would have read "a limit of 12 should fit"), and the protocol page explains
why the cap cannot be predicted up front.

**#57** (related_tools: battles_levels) — Thank you; this one is on the
record as the negative control. The mode argument on battles_levels stays,
and its level gap is now beside every win rate in battles_decks and
battles_cards (3.13.0), which is exactly your suggestion. notes[] remains the
carrier and the new notes fire on a detected confound rather than as a
standing caveat.

**#58** (related_tools: battles_query) — Shipped in 3.13.0, all three: every
teammate and opponent object carries its own elixir_leaked at full verbosity
(you were right that the record already held both sides — the log row carries
both), me.elixir_leaked_differential is me minus the one opponent on
head-to-head rows (null on duels, 2v2 and unreported sides), and a note rides
every page that serves the field: the absolute describes the match, the
differential is the better read, and neither separates waste from holding to
react, so neither is a skill measure. The battles page says the same.

**#59** (related_tools: battles_performance, battles_query) — Shipped in
3.13.0. battles_performance carries trophy_floor when the window holds ladder
battles and the arena's floor is known: floor, arena, source
(losses_on_floor or arena_snapshots), floored, on_floor_losses (trophy_change
null), losses_landing_on_floor, ladder_battles and trophy_range; the note
fires when a loss touched it and says net_trophies counts wins in full and
those losses at zero. battles_query says in a note how many ladder losses on
the page carry trophy_change null and why, and the battles page documents
the null (a loss standing ON the floor; a loss just above it is clamped). Not
done: a floor-robust companion metric — trophy_range is there as the honest
substitute for now.

**#60** (related_tools: battles_performance, battles_levels, war_current) —
Shipped in 3.13.0. (1) group_by:"week" rows the window clips carry
partial: true and covers {from, to}, and a note names them — your W34 row
now reads covers 2026-08-19 → 2026-08-24. (2) methodology.n says n counts the
scored player's qualifying battles, once each; the bins count both sides.
(3) war_current and war_history say in a note, and the battles page under war
weeks, that decks_used is the race week's cumulative count, decks_today the
policy day's, and a duel consumes one deck per round played (two or three).
