/**
 * The player map and Near you (#768, Jamie 2026-11-14: city-level
 * location is fine for everyone, young players included). The places are
 * Clan ledger items read only through the approved seam
 * (`@elixir-mcp/auth/clan-context`, its player map and Near you readers,
 * called from `people.mjs`);
 * here they are resolved against the same GeoNames lists the clan map
 * uses, so a pin is exactly the clan map's: a city's own point, a region's
 * middle or a country's, never finer than the place its owner picked.
 * Signed-in people only; nothing here reaches MCP or the JSON API.
 */
import { diskGeo } from "@elixir-mcp/clan/geo.mjs";

let lists = null;
const geo = () => (lists ??= diskGeo());

/** The words and pin of a place's codes, as the clan map shows them, or
 *  null for a place the lists no longer hold. */
export async function resolvePlace(codes) {
  const place = await geo().resolve(codes);
  return place.error ? null : place;
}

/** The place's own name, most specific first: what "Plays near you, in
 *  <...>" names. Never finer than the place. */
export const placeName = (place) =>
  place.city_name ?? place.region_name ?? place.country_name;

export const MAP_ATTRIBUTION =
  "Places from GeoNames (geonames.org, CC BY 4.0). Map © OpenStreetMap contributors.";
