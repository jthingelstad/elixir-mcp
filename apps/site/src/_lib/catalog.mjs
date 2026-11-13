/**
 * The public card catalog's body, fetched once per build and shared by
 * _data/cards.js (the pages) and _data/catalogAsOf.js (the sitemap's
 * date for them). Kept out of _data because Eleventy hands a data module
 * with named exports to templates as an object of its exports.
 *
 * Retry, then fail (_lib/fetch-public.mjs): the site phase publishes
 * with removeMissing, so a build without the catalog would delete every
 * card page. A test build (ELIXIR_SKIP_STATS=1) reads the fixture instead.
 */
import { readFile } from "node:fs/promises";
import { fetchPublicJson } from "./fetch-public.mjs";

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
  return fetchPublicJson(URL_, { label: "cards", timeoutMs: 20000 });
}

export function readCatalogBody() {
  body ??= fetchBody();
  return body;
}
