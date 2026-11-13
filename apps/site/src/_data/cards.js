/**
 * The card catalog, read at BUILD time from the public endpoint and
 * baked into a page per card and the /cards index's plain list.
 *
 * Retry, then fail, the same stance as stats.js: the catalog that cannot
 * be read fails the build, so the published card pages stay up instead
 * of being deleted by a publish that no longer has them.
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
