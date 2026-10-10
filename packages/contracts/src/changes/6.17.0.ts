import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.17.0",
  date: "2026-09-22",
  summary: md(
    "Event content is its own mode group, and it no longer informs the meta. Game modes are played as different games, and Elixir was pooling them.",
    list(
      "`event` joins the mode groups, decided by the API's own `eventTag` rather than by the battle type. `type: trail` carries one on 100% of 123,562 recorded battles and every permanent format carries one on 0%, so the tag - not the type, not the mode's name - is what marks time-bound content. `trail` used to fold into `casual`, which filed the reworked Seasonal Trophy Road as casual play and pooled a fortnight's 2v2 tournament with ordinary friendlies. `mode: 'event'` selects it; every other `mode` now excludes it.",
      "The meta population EXCLUDES event content and decks the player did not choose (`deck_selection` outside `collection` and `warDeckPick`: eventDeck, draft, draftCompetitive, pick, quadDeckPick, predefined). A Seasonal Arena II deck is floored at Level 15 - its recorded decks average 15.87 against 13.67 on Trophy Road - and a drafted deck is not a deck anyone chose, so a win rate over either measures the format. Both remain fully readable through `battles_query` and a player's own record.",
      "`event` is a FILTER, never a population: one event is not another. `trail`+`TeamVsTeam` alone has carried ten distinct event tags, and a rate over event content must key on `context.event_tag` itself.",
    ),
    "A player's own battle counts are unchanged in total; battles that used to read `casual` now read `event`. Meta and deck statistics change: they were counting populations that do not describe the meta.",
  ),
} satisfies ChangelogEntry;
