/**
 * Card art (2026-10-08, Jamie: "Card art should be in the api response
 * for cards."). The art a card response carries comes from the API's own
 * `iconUrls`, one per form the catalog names (medium -> base,
 * evolutionMedium -> evolution, heroMedium -> hero), and is served from
 * Elixir's mirror on its own origin, never Supercell's CDN: the mirror
 * (infra/scripts/mirror-card-art.mjs, run by every deploy) copies each
 * of those images at three widths. A surface reads the art the response
 * names and never builds a file name for a form the catalog did not
 * list: on 2026-10-08 a top player's Ladder showed Hero Electro Wizard
 * and Evo Electro Giant as text because the web guessed names the
 * mirror had never written.
 *
 * Each URL names the full-width image (285 pixels); the same image is
 * published at every width in CARD_ART_WIDTHS, at the same address with
 * the width swapped (`cardArtAt`).
 */
import { ELIXIR_ORIGIN } from "./battle-link.js";
import { cardType, type PlayedForm } from "./levels.js";

/** The widths the mirror writes, smallest first. */
export const CARD_ART_WIDTHS = [128, 192, 285] as const;
export type CardArtWidth = (typeof CARD_ART_WIDTHS)[number];

/** The width a card response's art URL names: the source's own. */
export const CARD_ART_FULL_WIDTH: CardArtWidth = 285;

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

/** The mirrored file's path on Elixir's origin for one card, form and
 *  width: the one place the mirror's naming lives. */
export function cardArtPath(
  cardId: number,
  form: PlayedForm = "base",
  width: CardArtWidth = CARD_ART_FULL_WIDTH,
): string {
  const suffix = CARD_ART_FORMS.find(([f]) => f === form)?.[2] ?? "";
  return `/assets/cards/${cardId}${suffix}-${width}.png`;
}

/** The art a card response carries, from the API's iconUrls: an
 *  absolute URL per form the catalog lists, or null when it lists none
 *  (a card only battles have named, never the catalog) or for a tower
 *  troop, which the mirror does not copy. */
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

/** A served art URL at another of the mirror's widths. */
export function cardArtAt(url: string, width: CardArtWidth): string {
  return url.replace(/-\d+\.png$/, `-${width}.png`);
}
