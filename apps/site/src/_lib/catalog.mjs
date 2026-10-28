/**
 * The public card catalog's body, fetched once per build and shared by
 * _data/cards.js (the pages) and _data/catalogAsOf.js (the sitemap's
 * date for them). Kept out of _data because Eleventy hands a data module
 * with named exports to templates as an object of its exports.
 *
 * Skip-not-fail (cards.js says why): null when the endpoint cannot be
 * read. A test build (ELIXIR_SKIP_STATS=1) reads the fixture instead.
 */
import { readFile } from "node:fs/promises";

const URL_ =
  process.env.ELIXIR_CARDS_URL ??
  "https://elixir.poapkings.com/api/public/cards";
const FIXTURE = new URL(
  "../../test/fixtures/public-cards.json",
  import.meta.url,
);

let body;
async function fetchBody() {
  if (process.env.ELIXIR_SKIP_STATS === "1")
    return JSON.parse(await readFile(FIXTURE, "utf8"));
  try {
    const res = await fetch(URL_, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.warn(`[site] cards skipped: endpoint ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[site] cards skipped: ${err.message}`);
    return null;
  }
}

export function readCatalogBody() {
  body ??= fetchBody();
  return body;
}
