import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.5.0",
  date: "2026-10-08",
  summary: md(
    "Card responses carry each card's art: one image per form the Clash Royale catalog lists (base, evolution, hero), served from Elixir's own origin, so an agent or page can show the card without building a file name or calling Supercell's CDN.",
    list(
      "cards_card: card.art maps each form the card has to its image, 285 pixels wide (the same address ending -128.png or -192.png is narrower), or null for a tower troop or a card the catalog has not listed.",
      "cards_catalog: each card carries art when ids or query name the cards. The whole unnarrowed catalog leaves art out to stay under the result cap; compact never carries it.",
      "Show a played form's art, else the base card's: a form the catalog lists before Supercell publishes its image does not answer yet (Hero Electro Wizard and Evo Electro Giant on 2026-10-08).",
    ),
    "Additive: no arguments change. JSON API 3.1.0 is unchanged; the public card doors (/api/public/cards and /api/public/cards/{id}) gain art too.",
  ),
} satisfies ChangelogEntry;
