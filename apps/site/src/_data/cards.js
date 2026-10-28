/**
 * The card catalog, read at BUILD time from the public endpoint and
 * baked into a page per card and the /cards index's plain list.
 *
 * Skip-not-fail, the same stance as stats.js: a first deploy has no
 * endpoint to call yet, and a build must never be held hostage to a
 * running service. No catalog means no card pages this build, and they
 * arrive on the next one.
 *
 * Only catalog facts are baked (name, rarity, type, cost, forms); the
 * pages carry no play statistics.
 *
 * A test build (ELIXIR_SKIP_STATS=1, CI and the e2e journeys) reads six
 * real catalog rows from test/fixtures/public-cards.json instead of the
 * network, so the card pages and the index are built and tested there
 * too.
 */
import { readCatalogBody } from "../_lib/catalog.mjs";
import { shapeCards } from "../_lib/cards.mjs";

export default async function cards() {
  return shapeCards((await readCatalogBody()) ?? {});
}
