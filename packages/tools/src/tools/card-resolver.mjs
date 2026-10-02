import { ToolFailure } from "./shared.mjs";
import { catalogItems } from "./cards.mjs";

export async function resolveCard(
  db,
  { card_id, card },
  { allowTower = false } = {},
) {
  const all = await catalogItems(db);
  const items = all.filter((r) => r.kind === "card").map((r) => r.item);
  const towers = all.filter((r) => r.kind !== "card").map((r) => r.item);
  // A deck card wins an exact name over a tower troop that shares it
  // (Gym #324: the catalog lists an "Archer Queen" tower troop no deck has
  // used, and the name found it before the champion 45 of 48 members hold).
  const lower = (v) =>
    String(v ?? "")
      .trim()
      .toLowerCase();
  // "Evo Witch" / "Hero Knight" name the card in a form (Gym #325): the
  // card tools read every form of a card, so the prefix resolves to it.
  const unprefixed = (v) =>
    lower(v).replace(/^(evo(lution|lved)?|hero)\s+/, "");
  const tower =
    card_id !== undefined
      ? towers.find((c) => c.id === Number(card_id))
      : items.some((c) => lower(c.name) === lower(card))
        ? undefined
        : towers.find((c) => lower(c.name) === lower(card));
  // cards_card reads a tower troop as the deck's ninth card (Jamie
  // 2026-09-24); the pairing tools stay on the eight.
  if (tower && allowTower) return { ...tower, tower_troop: true };
  if (tower)
    throw new ToolFailure(
      "bad_request",
      `${tower.name} (${tower.id}) is a tower troop, not one of the eight deck cards this tool pairs.`,
      "cards_catalog lists tower troops, and cards_card reads their recorded facts.",
    );
  if (card_id !== undefined) {
    const id = Number(card_id);
    const hit = items.find((c) => c.id === id);
    if (!hit)
      throw new ToolFailure(
        "not_found",
        `No card with id ${card_id} in the catalog.`,
        "cards_catalog lists every id.",
      );
    return hit;
  }
  const name = lower(card);
  if (!name) throw new ToolFailure("bad_request", "Give card_id or card.");
  const exact = items.filter((c) => lower(c.name) === name);
  if (exact.length === 1) return exact[0];
  const bare = unprefixed(card);
  if (bare !== name) {
    const formHit = items.filter((c) => lower(c.name) === bare);
    if (formHit.length === 1) return formHit[0];
  }
  const near = items.filter((c) => lower(c.name).includes(bare));
  throw new ToolFailure(
    near.length ? "bad_request" : "not_found",
    near.length
      ? `'${card}' is not an exact card name. Candidates: ${near.map((c) => `${c.name} (${c.id})`).join(", ")}.`
      : `No card named '${card}'.`,
    "Names resolve only on an exact match so Witch is never read as Mother Witch (an Evo or Hero prefix names the card itself); pass card_id to be unambiguous.",
  );
}
