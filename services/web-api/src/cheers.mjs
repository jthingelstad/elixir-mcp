/**
 * Cheers (social slice 7, #765): a signed-in person's one reaction to a
 * timeline item, from six that all celebrate (Jamie, 2026-11-12: "Yes, six
 * cheers (Recommended)"; DECISIONS "Reactions, not comments"). One per
 * person per item: cheering again with another changes it, with the same
 * one or none takes it back.
 *
 * Who sees what: every reader of an item sees how many of each cheer it
 * has, and their own; nobody sees who cheered. Counts are per item (the
 * timeline's story id names the happening, never the reader), never per
 * recipient. Nothing here reaches Discord, mail, MCP or /api/v1.
 *
 * A cheer is stored only on an item in the person's own feed: the route
 * rebuilds the last seven days for the item's subjects the person follows
 * (one to a few subjects, not the whole feed) and finds the id there.
 * Taking a cheer back needs no such check.
 */
import { normalizeTag } from "@elixir-mcp/contracts";
import { buildTimeline } from "@elixir-mcp/tools/activity/entries";

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
const KEYS = new Set(CHEER_KEYS);

const ITEM_ID_RE = /^tl_[0-9a-f]{20}$/;

/** Cheers one person may set or take back in an hour. A tap rebuilds a
 *  slice of the feed, so the cap is about cost as well as abuse. */
export const CHEERS_PER_HOUR = 120;

/** The feed's own items carry cheers; the account's administration (its
 *  sign-ins, connections and feedback answers) is seen by nobody else and
 *  has none. */
const cheerable = (it) => Boolean(it?.id) && it.section !== "account";

/** Each item's cheers, as counts and the reader's own: a Map of item id to
 *  `{ cheers: { well_played: 2, … }, my_cheer }`, only for items that have
 *  any or that the reader cheered. One read for the whole page. */
async function cheersFor(db, itemIds, accountId) {
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

/** Is this item in the person's own feed, as of now? The item's subjects
 *  the account follows (the page sends the item's subject tags; only the
 *  account's own follows count), the last seven days, the same build the
 *  feed made. */
export async function inOwnFeed(db, { accountId, itemId, tags, subjects }) {
  const asked = new Set(tags);
  const mine = subjects.filter((s) => asked.has(s.tag));
  if (mine.length === 0) return false;
  const toMs = Date.now();
  const built = await buildTimeline(db, mine, {
    fromMs: toMs - 7 * 86_400_000,
    toMs,
    accountId,
    interactive: true,
  });
  return built.timeline.some((it) => it.id === itemId && cheerable(it));
}

/** Set, change or take back the person's cheer on an item; `cheer` null
 *  takes it back. Answers the item's counts after the write. */
export async function setCheer(db, accountId, itemId, cheer) {
  if (cheer === null)
    await db.query(
      `delete from timeline_cheer where account_id = $1 and item_id = $2`,
      [accountId, itemId],
    );
  else
    await db.query(
      `insert into timeline_cheer (account_id, item_id, cheer)
       values ($1, $2, $3)
       on conflict (account_id, item_id)
       do update set cheer = excluded.cheer, updated_at = now()`,
      [accountId, itemId, cheer],
    );
  const found = (await cheersFor(db, [itemId], accountId)).get(itemId);
  return {
    item_id: itemId,
    cheers: found?.cheers ?? {},
    my_cheer: found?.my_cheer ?? null,
  };
}

/** What the request names, or why it is refused. */
export function readCheerBody(body) {
  const itemId = String(body?.item_id ?? "");
  if (!ITEM_ID_RE.test(itemId))
    return { error: "invalid_item", message: "Name a timeline item." };
  const cheer = body?.cheer ?? null;
  if (cheer !== null && !KEYS.has(cheer))
    return {
      error: "invalid_cheer",
      message: `A cheer is one of ${CHEER_KEYS.join(", ")}, or null to take yours back.`,
    };
  const tags = [];
  for (const raw of Array.isArray(body?.subjects)
    ? body.subjects.slice(0, 8)
    : []) {
    try {
      tags.push(normalizeTag(String(raw)));
    } catch {
      // Not a tag: it names nothing the account follows.
    }
  }
  return { itemId, cheer, tags };
}
