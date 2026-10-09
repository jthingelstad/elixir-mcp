/**
 * Card art (2026-10-08, Jamie: "Card art should be in the api response
 * for cards."). The art a card response carries comes from the API's own
 * `iconUrls`, one per form the catalog names (medium -> base,
 * evolutionMedium -> evolution, heroMedium -> hero), and is served from
 * Elixir's mirror on its own origin, never Supercell's CDN: the mirror
 * (infra/scripts/mirror-card-art.mjs, run by every deploy) stores each
 * of those images as a byte-identical copy. A surface reads the art the
 * response names and never builds a file name for a form the catalog did
 * not list: on 2026-10-08 a top player's Ladder showed Hero Electro
 * Wizard and Evo Electro Giant as text because the web guessed names the
 * mirror had never written.
 *
 * The art is Supercell's, and it is never altered (Jamie, 2026-10-08:
 * "it is important with card art that we not modify it at all. we can
 * host them locally, but you cannot resize the images or alter them in
 * anyway."). Each URL names the one file per card and form, exactly the
 * bytes the API's icon URL serves; a surface sizes it with HTML or CSS
 * only. There are no narrower copies.
 *
 * A form the catalog lists can lack its image for about two weeks after
 * Supercell releases it (Supercell's CDN answers 404 until then); the
 * mirror retries it on every deploy, and until it lands a surface draws
 * the base card's art under the form's ribbon (`cardArtFor`).
 */
import { ELIXIR_ORIGIN } from "./battle-link.js";
import { cardType, type PlayedForm } from "./levels.js";

/** Each form, its key in the API's iconUrls and its file suffix. */
export const CARD_ART_FORMS: ReadonlyArray<
  readonly [form: PlayedForm, iconKey: string, suffix: string]
> = [
  ["base", "medium", ""],
  ["evolution", "evolutionMedium", "_evo"],
  ["hero", "heroMedium", "_hero"],
];

/** A card's art by form; a form is present only when the API carries
 *  its icon. */
export type CardArt = Partial<Record<PlayedForm, string>>;

/** The mirrored file's path on Elixir's origin for one card and form:
 *  the one place the mirror's naming lives. The file is the API's own
 *  PNG, byte for byte. */
export function cardArtPath(cardId: number, form: PlayedForm = "base"): string {
  const suffix = CARD_ART_FORMS.find(([f]) => f === form)?.[2] ?? "";
  return `/assets/cards/${cardId}${suffix}.png`;
}

/** The art a card response carries, from the API's iconUrls: an
 *  absolute URL per form the catalog lists, or null when it lists none
 *  (a card only battles have named, never the catalog) or for a tower
 *  troop, which no surface draws. */
export function cardArt(
  cardId: number,
  iconUrls: Record<string, unknown> | null | undefined,
): CardArt | null {
  if (cardType(cardId) === "tower_troop") return null;
  const out: CardArt = {};
  for (const [form, key] of CARD_ART_FORMS)
    if (typeof iconUrls?.[key] === "string" && iconUrls[key])
      out[form] = `${ELIXIR_ORIGIN}${cardArtPath(cardId, form)}`;
  return Object.keys(out).length > 0 ? out : null;
}

/** The art to draw for a card played in a form: that form's, else the
 *  base card's, else null (the surface writes the card's name). */
export function cardArtFor(
  art: CardArt | null | undefined,
  form: PlayedForm | null | undefined,
): string | null {
  return art?.[form ?? "base"] ?? art?.base ?? null;
}
