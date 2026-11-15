/**
 * Cards: the cards you played and the cards you faced in one mode this
 * season, as battles_cards returns them (mine and opponent). A form is its
 * own card here, as it is in the tool: an Evo Witch row and a Witch row are
 * two records. Nothing here adds rows up, rates a card or labels one; the
 * order is the tool's (most battles first).
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

/** The mode's battles as the tool counted them for this answer. */
export const modeBattles = (body, mode) =>
  body?.modes_in_window?.[mode]?.battles ?? null;
