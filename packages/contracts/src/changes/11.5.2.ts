import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.5.2",
  date: "2026-10-08",
  summary: md(
    "Card art is Supercell's, hosted unaltered: each art URL now names a byte-identical copy of the image the catalog's iconUrls name, one file per card and form (for example /assets/cards/26000042_hero.png), never resized, re-encoded or otherwise changed. Show it at any size with HTML or CSS.",
    list(
      "cards_card and cards_catalog: art values drop the -285 suffix, and the -128.png and -192.png copies 11.5.0 described no longer exist. The field, its keys and its forms are unchanged.",
      "A form the catalog lists can take about two weeks to answer after Supercell releases it (Hero Electro Wizard and Evo Electro Giant on 2026-10-08): show the base card's art until it does. Elixir checks again on every update.",
    ),
    "A correction: no arguments or fields change. JSON API 3.1.0 is unchanged; the public card doors (/api/public/cards and /api/public/cards/{id}) carry the same original-file URLs.",
  ),
} satisfies ChangelogEntry;
