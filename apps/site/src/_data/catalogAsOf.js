/** When the card catalog last changed (the public catalog's as_of): the
 *  sitemap dates the card pages by it (_lib/lastmod.mjs). */
import { readCatalogBody } from "../_lib/catalog.mjs";

export default async function catalogAsOf() {
  return (await readCatalogBody())?.as_of ?? null;
}
