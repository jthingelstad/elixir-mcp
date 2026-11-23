/**
 * Cheers' counts (social slice 7, #765): the reads every door shares. A cheer
 * is a signed-in person's one reaction to a timeline item, from twenty that
 * all celebrate (DECISIONS "Reactions, not comments"). Every reader of an item
 * sees how many of each cheer it has, and their own; nobody sees who cheered.
 *
 * Writing a cheer is the web's alone (services/web-api/src/cheers.mjs). MCP
 * reads cheers and never gives them: elixir_cheers reads the counts on items
 * about the reader's own player, never who, and never the reader's own
 * cheer.
 */

import { visibleClanInteractionSql } from "@elixir-mcp/record/clan-lifecycle";

/** The cheers, in the order the picker shows them: the six of 2026-11-12
 *  first, with their ids unchanged, then the fourteen added 2026-11-17
 *  ("Reactions are glyphs alone; a larger set"). The web app names and
 *  draws them (apps/web/src/home/cheer-set.js); this list is what the
 *  database allows (0243, widened by 0291), and a test pins the lists
 *  together. A kind is a word only to the app: mail, push, RSS and
 *  Discord never name one, and MCP serves the ids as counts. */
export const CHEER_KEYS = [
  "well_played",
  "on_fire",
  "royal",
  "wow",
  "ha",
  "grind",
  "love_it",
  "good_game",
  "congrats",
  "clutch",
  "high_five",
  "champion",
  "nailed_it",
  "climbing",
  "big_brain",
  "ice_cold",
  "close_one",
  "lucky",
  "fun_to_watch",
  "getting_better",
];

/** A timeline item's id, as a cheer names it. */
export const ITEM_ID_RE = /^tl_[0-9a-f]{20}$/;

/** The feed's own items carry cheers; the account's administration (its
 *  sign-ins, connections and feedback answers) is seen by nobody else and
 *  has none. */
export const cheerable = (it) => Boolean(it?.id) && it.section !== "account";

/** Each item's cheers, as counts and the reader's own: a Map of item id to
 *  `{ cheers: { well_played: 2, … }, my_cheer }`, only for items that have
 *  any or that the reader cheered. One read for the whole page. Cheers by
 *  anyone in a block with the reader, either way, are not counted in what
 *  the reader sees (0282). */
export async function cheersFor(db, itemIds, accountId) {
  const ids = [...new Set(itemIds.filter((id) => ITEM_ID_RE.test(id)))];
  const out = new Map();
  if (ids.length === 0) return out;
  const { rows } = await db.query(
    `select item_id, cheer, count(*)::int as n,
            bool_or(account_id = $2) as mine
       from timeline_cheer c
      where item_id = any($1::text[]) and ${visibleClanInteractionSql("c", "$2")}
        and ($2::uuid is null or not exists (
              select 1 from account_block ab
               where (ab.account_id = $2 and ab.blocked_account_id = c.account_id)
                  or (ab.account_id = c.account_id and ab.blocked_account_id = $2)))
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
