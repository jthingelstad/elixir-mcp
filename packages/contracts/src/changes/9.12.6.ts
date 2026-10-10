import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.12.6",
  date: "2026-09-28",
  summary: md(
    "`cards_catalog` lists the cards the current `/cards` catalog lists, 123 today, as 9.12.5 did for tower troops (#44). It had also listed eleven cards known only from battles, such as the event-only Super Archers and Party Rocket, with no rarity or cost; `/cards` never lists them. They stay on the record, and `cards_card` still answers them by id. A card first seen in a battle on its release day is listed once `/cards` lists it, which the recorder fetches as soon as it sees one. Behaviour correction; no output-schema change.",
  ),
} satisfies ChangelogEntry;
