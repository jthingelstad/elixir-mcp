# Keep the Record True

Own the outcome: **what Elixir MCP recorded is what actually happened in
the game, and our model of the Clash Royale API stays current.** The
recorder can be perfectly healthy and still wrong — a projection
misreading a field, a war clock drifting from the calendar, a new card
form merged into an old one. Error-free is not correct; this owner
samples real values against game reality (the Observatory rule).

## Every run

- **Capture completeness.** The capture-audit verdicts (public status,
  24h and trend): gaps mean the rotating battlelog rolled past unseen
  battles — quantify which subjects and whether cadence policy or fleet
  capacity is the cause. First-polls are history arriving, never gaps.
- **Projection spot-checks.** Pick a handful of recent battles/war rows
  and trace payload → projection: battle_time semantics (ISO-Z, played
  not observed), points-vs-fame discipline (member points are never
  fame; fame belongs to the boat), war keys stamped from the battle's
  own time, card levels on the in-game 1–16 scale at the one rarity
  seam, evolution/hero forms kept distinct.
- **The clocks.** The war period anchor vs the calendar-derived season
  (first Monday → first Monday); a new season or Colosseum boundary is
  the moment drift shows. Time-derived identity comes from the
  calendar, never a state machine (the phantom-season scar).
- **API drift.** Anything in fresh payloads our docs don't describe —
  new fields, changed enums, new game modes, a card catalog change
  after a game update. `~/Projects/cr-agent-api-docs` is CR truth:
  when the live API surprises us, patching those docs is part of the
  fix, same commit ethic.
- **Honesty machinery.** Coverage and completeness tools still tell the
  truth: recording-start disclosure, null-not-zero for unknowns, sample
  sizes riding every rate.

## Action

- A wrong projection gets fixed at the projector with a regression test
  pinned to a real fixture, then evaluated for backfill: can the S3
  payload archive replay repair history? If yes, repair; if not, the
  limitation is documented where readers will meet it.
- A schema-affecting fix is an ordered migration applied by the migrate
  lambda — never hand-applied. Fingerprints re-pin from a FRESH scratch
  database.
- A purge or restatement must sweep EVERY table carrying the poisoned
  key, and any stamp-once field needs a revisit story (the 0021/0022
  lesson).
- New game content (cards, modes, mechanics) that the record handles
  wrongly is this owner's gap even when nothing crashes.

## Success

Sampled values match the game. The capture-audit trend is understood,
not just green. cr-agent-api-docs would let a stranger predict every
payload we receive. When Keep the Record True finds nothing, the record
has earned the "no gaps is a measurement" claim the Status page makes.
