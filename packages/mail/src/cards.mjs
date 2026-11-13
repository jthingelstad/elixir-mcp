/** Card art in mail: the mirrored files on Elixir's own origin, drawn in
 *  tables. Every kind that shows a card (a deck, an unlocked card, a
 *  collector's card, the Card of the Week) goes through here, so the
 *  URL rule lives in one place.
 *
 *  The files are infra/scripts/mirror-card-art.mjs's: one per card and
 *  form, a byte-identical copy of the image the API's iconUrls name,
 *  uploaded with the site. The art is never resized or altered (Jamie,
 *  2026-10-08: "you cannot resize the images or alter them in
 *  anyway"): a mail sizes it with the image's width and height and the
 *  client scales it. Mail never hotlinks Supercell's CDN: a mail client
 *  proxies or blocks a third-party image. */
import { cardArtPath } from "@elixir-mcp/contracts";
import { SITE, esc } from "./shell.mjs";

const FORMS = new Set(["evolution", "hero"]);
const formOf = (form) => (FORMS.has(form) ? form : "base");

/** The mirrored file for a card and form (contracts card-art.ts). */
export const cardAsset = (cardId, form) =>
  `${SITE}${cardArtPath(cardId, formOf(form))}`;

/** A card object as the renderers draw it: an id, a name and a form. */
const isCard = (v) =>
  v != null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Number.isInteger(Number(v.id)) &&
  v.id != null &&
  typeof v.name === "string" &&
  FORMS.has(v.form);

/** Each Evo or Hero card in a mail's facts, given the base card's art
 *  when the mirror does not hold its form's (`art_src`), decided at
 *  compose time because a mail client cannot fall back the way a page
 *  does. Supercell lists a new form about two weeks before its image
 *  answers, so a missing form is expected then. `held(path)` answers
 *  whether the mirror holds a file (services/jobs reads the site
 *  bucket); asked once per path. The form and the card's name are
 *  untouched, so the alt text still names the form played. Returns new
 *  facts; the input is not changed. */
export async function resolveCardArt(facts, held) {
  const asked = new Map();
  const has = (p) => {
    if (!asked.has(p))
      asked.set(
        p,
        Promise.resolve(held(p)).catch(() => false),
      );
    return asked.get(p);
  };
  const walk = async (v) => {
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v == null || typeof v !== "object" || v instanceof Date) return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = await walk(x);
    if (isCard(v) && !v.icon && !v.art_src) {
      const id = Number(v.id);
      if (!(await has(cardArtPath(id, v.form)))) out.art_src = cardAsset(id);
    }
    return out;
  };
  return walk(facts);
}

/** Card art is 2:3 portrait (the frame, 285x420 at source), never a
 *  square icon, so a width carries its height: a cell that sets only the
 *  width stretches in Outlook, which ignores `height:auto`. */
const cardHeight = (w) => Math.round((w * 420) / 285);

/** A card as a player says it: "Evo Royal Hogs", "Hero Mini P.E.K.K.A". */
const cardFormLabel = (card) =>
  `${card.form === "hero" ? "Hero " : card.form === "evolution" ? "Evo " : ""}${card.name}`;

/** One card image. `card` is {id, name, form}, or carries its own
 *  `icon` (a Card of the Week issue stored before 2026-10-01), or the
 *  base card's art as `art_src` when its form's image is not mirrored
 *  yet (resolveCardArt). `w` is the display width: the file is the
 *  original, and width and height scale it. Its alt
 *  is the card's name with its form: what the text part prints and what
 *  a client with images off shows. On one line: the text part breaks a
 *  line on every newline in the source. */
export function cardImg(card, w, { radius = 6 } = {}) {
  const src = card.icon ?? card.art_src ?? cardAsset(card.id, card.form);
  return `<img src="${src}" alt="${esc(cardFormLabel(card))}" width="${w}" height="${cardHeight(w)}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:${radius}px;" />`;
}
