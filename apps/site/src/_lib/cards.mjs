/**
 * The card catalog's shape for the site: the facts a card's page and the
 * cards index bake (name, rarity, type, cost, forms) and the words the
 * pages use for its forms. Kept out of _data/cards.js because Eleventy
 * hands a data module with named exports to templates as an object of
 * its exports, not as its default.
 */
/** "Evo", "Hero", "Evo and Hero": the forms a card has, as the pages
 *  name them. */
export function formsLabel(forms) {
  const names = (forms ?? [])
    .map((f) => (f === "evolution" ? "Evo" : f === "hero" ? "Hero" : null))
    .filter(Boolean);
  return names.join(" and ");
}

/** "also an Evo", "also a Hero", "also an Evo and a Hero": the line under
 *  a card page's name. Empty for a card with no other form. */
export function alsoLabel(forms) {
  const names = (forms ?? [])
    .map((f) => (f === "evolution" ? "an Evo" : f === "hero" ? "a Hero" : null))
    .filter(Boolean);
  return names.length ? `also ${names.join(" and ")}` : "";
}

/** The form a card page draws its art in: Hero over Evo over the base
 *  card, as the canvas draws it (CardPage, 2026-09-29). */
export function artForm(forms) {
  const f = forms ?? [];
  return f.includes("hero")
    ? "hero"
    : f.includes("evolution")
      ? "evolution"
      : "base";
}

/** A catalog art URL as this origin's own path: the pages are served
 *  from the origin the art is on (and a local build serves its own
 *  copy). The file is the mirror's one copy of the form, Supercell's own
 *  bytes; the page sizes it with width and height (Jamie, 2026-10-08:
 *  "you cannot resize the images or alter them in anyway"). */
const artPath = (url) =>
  url ? String(url).replace(/^https?:\/\/[^/]+/, "") : null;

/** The art a card's page and tile draw (2026-10-08, Jamie: "Card art
 *  should be in the api response for cards"): the catalog's own `art`,
 *  the page's form else the base card. A catalog without `art` (one
 *  served before 11.5.0) falls back to the mirror's names. */
export function artOf(c, form) {
  const sfx = { hero: "_hero", evolution: "_evo", base: "" };
  const named = (f) =>
    c.art ? (c.art[f] ?? null) : `/assets/cards/${c.id}${sfx[f]}.png`;
  const figure = artPath(named(form) ?? named("base"));
  const base = artPath(named("base"));
  return {
    figure,
    figure_base: figure !== base ? base : null,
    tile: base,
  };
}

/** The public catalog (GET /api/public/cards) as the pages bake it: real
 *  cards only (a cost and art), A to Z. */
export function shapeCards(body) {
  return (body.cards ?? [])
    .filter((c) => c.elixirCost != null && c.iconUrls?.medium)
    .map((c) => ({
      id: c.id,
      name: c.name,
      rarity: c.rarity ?? null,
      type: c.type ?? null,
      elixir: c.elixirCost ?? null,
      forms: c.forms_available ?? [],
      formsLabel: formsLabel(c.forms_available),
      also: alsoLabel(c.forms_available),
      artForm: artForm(c.forms_available),
      art: artOf(c, artForm(c.forms_available)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
