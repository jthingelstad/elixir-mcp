/** battles_query · battles_performance · battles_cards · battles_decks ·
 *  battles_meta_decks · battles_meta_cards · battles_trends ·
 *  battles_compare. Conventions (1.0.0, shared.mjs):
 *  from/to + timezone on every windowed tool, one `applied` echo,
 *  `notes[]` + `docs`, `verbosity` as the size control, nested `segment`
 *  on the corpus-wide tools. */

import { battles_query } from "./battles/query.mjs";
import { battles_performance } from "./battles/performance.mjs";
import { battles_cards } from "./battles/cards.mjs";
import { battles_decks } from "./battles/decks.mjs";
import { battles_meta_decks } from "./battles/meta-decks.mjs";
import { battles_meta_cards } from "./battles/meta-cards.mjs";
import { battles_trends } from "./battles/trends.mjs";
import { battles_compare } from "./battles/compare.mjs";

export const battlesTools = {
  battles_query,
  battles_performance,
  battles_cards,
  battles_decks,
  battles_meta_decks,
  battles_meta_cards,
  battles_trends,
  battles_compare,
};
