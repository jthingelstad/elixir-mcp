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
import { SITE, FONT, M, esc } from "./shell.mjs";

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
export const cardFormLabel = (card) =>
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

/** A deck as the game draws it: one strip of eight. Table cells, never
 *  flex or grid; each cell is a fixed share so a phone narrows the
 *  strip instead of wrapping it. The tower troop is text, under it. */
export function deckStrip(cards, { w = 56, gap = 6 } = {}) {
  const list = (cards ?? []).filter((c) => c && (c.icon || c.id != null));
  if (!list.length) return "";
  const pct = (100 / 8).toFixed(1);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;max-width:${8 * (w + gap)}px;"><tr>${list
    .slice(0, 8)
    .map(
      (c, i) =>
        `<td width="${pct}%" valign="top" style="padding:0 ${i < 7 ? gap : 0}px 0 0;">${cardImg(c, w)}</td>`,
    )
    .join(
      "",
    )}${Array.from({ length: Math.max(0, 8 - list.length) }, () => `<td width="${pct}%"></td>`).join("")}</tr></table>`;
}

/** A row of single cards, each with its name (a link when `link` maps a
 *  card to its page) and a line under it: up to three across. */
export function cardTiles(items, { w = 96, link = null } = {}) {
  const row = items.slice(0, 3);
  const pct = Math.floor(100 / Math.max(3, row.length));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${row
    .map(({ card, line }, i) => {
      const inner = `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="width:${w}px;">${cardImg(card, w, { radius: 8 })}</td></tr></table>
        <div style="font-family:${FONT};font-size:15px;font-weight:700;color:${M.ink};margin-top:8px;">${link ? `<a href="${esc(link(card))}" style="color:${M.ink};text-decoration:none;">${esc(card.name)}</a>` : esc(card.name)}</div>
        ${line ? `<div style="font-family:${FONT};font-size:12px;color:${M.faint};margin-top:2px;">${esc(line)}</div>` : ""}`;
      return `<td width="${pct}%" valign="top" style="padding:0 ${i < row.length - 1 ? 5 : 0}px 0 ${i ? 5 : 0}px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${M.box}" style="background-color:${M.box};border:1px solid ${M.edge};border-radius:12px;padding:14px 8px 12px;">${inner}</td></tr></table></td>`;
    })
    .join(
      "",
    )}${Array.from({ length: Math.max(0, 3 - row.length) }, () => `<td width="${pct}%"></td>`).join("")}</tr></table>`;
}
