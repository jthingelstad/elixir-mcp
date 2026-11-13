/**
 * Cheers' counts (social slice 7, #765): the reads every door shares. A cheer
 * is a signed-in person's one reaction to a timeline item, from six that all
 * celebrate (DECISIONS "Reactions, not comments"). Every reader of an item
 * sees how many of each cheer it has, and their own; nobody sees who cheered.
 *
 * Writing a cheer is the web's alone (services/web-api/src/cheers.mjs). Agents
 * read cheers and never give them (DECISIONS "Agents read the social layer
 * and never write it"): MCP's elixir_cheers and its /api/v1 operation read
 * the counts on items about the reader's own player, never who, and never an
 * agent's own cheer, since an agent has none.
 */

/** The six, in the order the picker shows them. The web app names them
 *  (apps/web/src/home/cheer-set.js); this list is what the database allows
 *  (0243), and a test pins the two together. */
export const CHEER_KEYS = [
  "well_played",
  "on_fire",
  "royal",
  "wow",
  "ha",
  "grind",
];

/** A timeline item's id, as a cheer names it. */
export const ITEM_ID_RE = /^tl_[0-9a-f]{20}$/;

/** The feed's own items carry cheers; the account's administration (its
 *  sign-ins, connections and feedback answers) is seen by nobody else and
 *  has none. */
export const cheerable = (it) => Boolean(it?.id) && it.section !== "account";

/** Each item's cheers, as counts and the reader's own: a Map of item id to
 *  `{ cheers: { well_played: 2, … }, my_cheer }`, only for items that have
 *  any or that the reader cheered. One read for the whole page. */
export async function cheersFor(db, itemIds, accountId) {
  const ids = [...new Set(itemIds.filter((id) => ITEM_ID_RE.test(id)))];
  const out = new Map();
  if (ids.length === 0) return out;
  const { rows } = await db.query(
    `select item_id, cheer, count(*)::int as n,
            bool_or(account_id = $2) as mine
       from timeline_cheer
      where item_id = any($1::text[])
      group by item_id, cheer`,
    [ids, accountId ?? null],
  );
  for (const r of rows) {
    const one = out.get(r.item_id) ?? { cheers: {}, my_cheer: null };
    one.cheers[r.cheer] = r.n;
    if (r.mine) one.my_cheer = r.cheer;
    out.set(r.item_id, one);
  }
  return out;
}

/** The feed's items with their cheers: `cheers` (counts, only the cheers
 *  given) and `my_cheer` (yours, or null) on every item that can carry
 *  them. Counts only: never who. */
export async function withCheers(db, items, accountId) {
  const open = items.filter(cheerable);
  const found = await cheersFor(
    db,
    open.map((it) => it.id),
    accountId,
  );
  return items.map((it) =>
    cheerable(it)
      ? {
          ...it,
          cheers: found.get(it.id)?.cheers ?? {},
          my_cheer: found.get(it.id)?.my_cheer ?? null,
        }
      : it,
  );
}
