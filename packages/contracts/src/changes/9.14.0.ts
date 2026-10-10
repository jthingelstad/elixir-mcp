import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.14.0",
  date: "2026-09-28",
  summary: md(
    "An Evolution or Hero form newly unlocked is a timeline moment (#110). Until now the collection kept only which forms a card has, so an unlock passed silently.",
    list(
      '`elixir_timeline` has a new item kind, `card_form_unlocked`, in the `collection` section: `facts` carries `card`, `card_id`, `rarity` and `form` (`evolution` or `hero`), and the text reads "unlocked Hero Valkyrie". One item per form; `kinds` accepts it. `at` is the profile read that saw the unlock: it happened no later than that, and no earlier bound is served, because collectors skip a profile that has not changed.',
      "A player entry's `collection` carries `forms_unlocked` (as a player says them, capped like `unlocked`), and a player whose only news is a form unlock has an entry rather than a line in `quiet`.",
      "Recorded going forward from this release, never backfilled; a note says so on a window that begins before 2026-09-29. The milestone and tracking mails carry the moment too.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
