import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.9.0",
  date: "2026-09-26",
  summary: md(
    "`battles_decks` lists the decks a player played in duel rounds (`duel_decks`: each round's eight cards with its round record, most rounds first). A duel has no single deck, so it stays outside the rows and their shares, as before; but read back through a clan's agent at 9.8.1, \"a different last war deck\" read the player's war decks from the rows alone, missed the one they play only in duels, and recommended it back to them as the new one.",
  ),
} satisfies ChangelogEntry;
