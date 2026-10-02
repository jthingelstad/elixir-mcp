/**
 * The card catalog, read at BUILD time from the public endpoint and
 * baked into a page per card and the /cards index's plain list.
 *
 * Skip-not-fail, the same stance as stats.js: a first deploy has no
 * endpoint to call yet, and a build must never be held hostage to a
 * running service. No catalog means no card pages this build, and they
 * arrive on the next one.
 *
 * Only catalog FACTS are baked (name, rarity, type, cost, forms). How a
 * card is played moves every hour, so the pages read it live from the
 * same endpoint in the browser (cards-index.js, cards-live.js).
 *
 * A test build (ELIXIR_SKIP_STATS=1, CI and the e2e journeys) reads six
 * real catalog rows from test/fixtures/public-cards.json instead of the
 * network, so the card pages and the index are built and tested there
 * too. No season numbers are in it: those are always live.
 */
import { readFile } from "node:fs/promises";
import { shapeCards } from "../_lib/cards.mjs";

const URL_ =
  process.env.ELIXIR_CARDS_URL ??
  "https://elixir.poapkings.com/api/public/cards";
const FIXTURE = new URL(
  "../../test/fixtures/public-cards.json",
  import.meta.url,
);

export default async function cards() {
  if (process.env.ELIXIR_SKIP_STATS === "1")
    return shapeCards(JSON.parse(await readFile(FIXTURE, "utf8")));
  try {
    const res = await fetch(URL_, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.warn(`[site] cards skipped: endpoint ${res.status}`);
      return [];
    }
    return shapeCards(await res.json());
  } catch (err) {
    console.warn(`[site] cards skipped: ${err.message}`);
    return [];
  }
}
