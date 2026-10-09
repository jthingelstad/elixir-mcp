/** Card art in mail: the mirrored files on Elixir's own origin, drawn in
 *  tables. Every kind that shows a card (a deck, an unlocked card, a
 *  collector's card, the Card of the Week) goes through here, so the
 *  URL rule lives in one place.
 *
 *  The files are infra/scripts/mirror-card-art.mjs's: one per card and
 *  form at 128, 192 and 285 pixels wide, uploaded with the site. Mail
 *  never hotlinks Supercell's CDN: a mail client proxies or blocks a
 *  third-party image. */
import { CARD_ART_WIDTHS, cardArtPath } from "@elixir-mcp/contracts";
import { SITE, FONT, M, esc } from "./shell.mjs";

/** The asset for a DISPLAY width: the smallest file at least twice as
 *  wide, so a retina screen has real pixels to draw with (64 -> 128,
 *  96 -> 192, 160 -> 285). Above 142 the source's own 285 is the most
 *  there is; inventing pixels above it would only add bytes. The file's
 *  name is the mirror's own (contracts card-art.ts). */
export const cardAsset = (cardId, form, displayWidth) =>
  `${SITE}${cardArtPath(
    cardId,
    form === "hero" || form === "evolution" ? form : "base",
    CARD_ART_WIDTHS.find((w) => w >= displayWidth * 2) ?? 285,
  )}`;

/** Card art is 2:3 portrait (the frame, 285x420 at source), never a
 *  square icon, so a width carries its height: a cell that sets only the
 *  width stretches in Outlook, which ignores `height:auto`. */
const cardHeight = (w) => Math.round((w * 420) / 285);

/** A card as a player says it: "Evo Royal Hogs", "Hero Mini P.E.K.K.A". */
export const cardFormLabel = (card) =>
  `${card.form === "hero" ? "Hero " : card.form === "evolution" ? "Evo " : ""}${card.name}`;

/** One card image. `card` is {id, name, form}, or carries its own
 *  `icon` (a Card of the Week issue stored before 2026-10-01). Its alt
 *  is the card's name with its form: what the text part prints and what
 *  a client with images off shows. On one line: the text part breaks a
 *  line on every newline in the source. */
export function cardImg(card, w, { radius = 6 } = {}) {
  const src = card.icon ?? cardAsset(card.id, card.form, w);
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
