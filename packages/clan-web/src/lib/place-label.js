/** A place in words, most specific first. Apart from geo.js, whose place
 *  lists are Vite's import.meta.glob: a page the server renders
 *  (Settings › What members see's Location) can name a place without
 *  evaluating the lists, which exist only in the browser build. */
export const placeLabel = (p) =>
  [p.city_name, p.region_name, p.country_name].filter(Boolean).join(", ");
