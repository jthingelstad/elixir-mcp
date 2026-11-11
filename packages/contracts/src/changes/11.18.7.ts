import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.18.7",
  date: "2026-11-11",
  summary: md(
    "A sitting's trophy facts on the timeline no longer read a challenge's win counter as trophies (feedback #384). In a Classic Challenge, a 20-Win Challenge or another event run, the game reports the run's win counter as `starting_trophies` (1-10) and +1 a win as `trophy_change`; only Trophy Road, Path of Legends, the seasonal Trophy Road (event content under the Ladder ruleset), war and casual rows carry a trophy standing there.",
    list(
      "`elixir_timeline` (`session_standout`, `battle_session`): `best_win` rates only wins whose trophies are a standing, so `best_win.opponent.starting_trophies`, `trophy_change` and `trophies_after` are always trophies; a sitting whose only wins were challenge or tournament wins has no `best_win`, as a sitting with no rated win never had. `trophy_net_by_mode` leaves a challenge's +1s out, so a Classic Challenge sitting no longer shows an `event` net.",
    ),
    "A correction: no field added or removed, schemas unchanged. The JSON API is unchanged.",
  ),
} satisfies ChangelogEntry;
