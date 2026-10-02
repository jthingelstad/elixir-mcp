/**
 * Cards (LadderCards.dc.html): the cards you played and the cards you
 * faced in one mode this season, as battles_cards returns them (mine and
 * opponent), and the opponents behind them as battles_opponents counts
 * them. A form is its own card here, as it is in the tool: an Evo Witch
 * row and a Witch row are two records. Nothing here adds rows up, ranks
 * a card or names a nemesis.
 */
import { cardLabel, isTowerTroop } from "@elixir-mcp/ui";

/** One row per card and form, in the tool's order (most battles first). */
export function cardRows(body) {
  return (body?.cards ?? []).map((c) => {
    const card = { id: c.id, name: c.name, form: c.form ?? "base" };
    return {
      key: `${c.id}:${card.form}`,
      card,
      label: cardLabel(card),
      // A card's public page is per card, every form on it; a tower
      // troop has none.
      href: isTowerTroop(c.id) ? null : `/cards/${c.id}/`,
      battles: Number(c.battles ?? 0),
      wins: Number(c.wins ?? 0),
      losses: Number(c.losses ?? 0),
      rate: c.win_rate ?? null,
    };
  });
}

/** Distinct cards among the rows, forms of one card counted once. */
export const distinctCards = (rows) => new Set(rows.map((r) => r.card.id)).size;

/** The mode's battles as the tool counted them for this answer. */
export const modeBattles = (body, mode) =>
  body?.modes_in_window?.[mode]?.battles ?? null;

const ONE = { 1: "once", 2: "twice" };
/** "twice", "3 times". */
export const times = (n) => ONE[n] ?? `${n} times`;

const COUNT = ["None", "One", "Two", "Three", "Four", "Five", "Six"];
/** "One came back", "Two came back", "12 came back". */
export const cameBack = (n) => `${COUNT[n] ?? n} came back`;

/** An opponent as the page names them: the name the record holds, else
 *  the tag (name_known false: no observation ever carried one). */
export const opponentName = (o) =>
  o?.name_known !== false && o?.name ? o.name : (o?.player_tag ?? "");
