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
 * recipient. Writing a cheer is this module's and the web's alone; nothing
 * here reaches Discord or mail. The counts are read through
 * @elixir-mcp/tools/activity/cheers, which MCP's elixir_cheers reads
 * (12.0.0): a person's agent reads the counts on
 * items about its owner's player, never who, and never gives a cheer
 * (DECISIONS "Agents read the social layer and never write it").
 *
 * A cheer is stored only on an item in the person's own feed: the route
 * rebuilds the last seven days for the item's subjects the person follows
 * (one to a few subjects, not the whole feed) and finds the id there.
 * Taking a cheer back needs no such check.
 *
 * The player page and the battle page (2026-11-12) carry cheers by the same
 * rule: an item there takes cheers, and shows its counts, only while it is
 * in the reader's own feed, so a page never lets anyone cheer what Home
 * would not show them [engineering, 2026-11-12: the narrow reading].
 * `cheersOnPage` names those items; everything else on the page has none.
 */
import { blockedSql } from "@elixir-mcp/claims";
import { normalizeTag } from "@elixir-mcp/contracts";
import { resolveBattleRef } from "@elixir-mcp/record/battle-links";
import { buildTimeline, shownAt } from "@elixir-mcp/tools/activity/entries";
import {
  CHEER_KEYS,
  ITEM_ID_RE,
  cheerable,
  cheersFor,
  withCheers,
} from "@elixir-mcp/tools/activity/cheers";
import { proofOf } from "./feed.mjs";
import { canSeePost } from "./posts.mjs";

export { CHEER_KEYS, withCheers };
const KEYS = new Set(CHEER_KEYS);

/** Pages' cheer reads one person may make in an hour: one for each player
 *  page or battle page opened, each a slice of the feed rebuilt. */
export const CHEER_READS_PER_HOUR = 240;

/** Cheers one person may set or take back in an hour. A tap rebuilds a
 *  slice of the feed, so the cap is about cost as well as abuse. */
export const CHEERS_PER_HOUR = 120;

/** The person's own feed now, for some of its subjects: the last seven
 *  days, the same build the feed made, only the items that take cheers.
 *  `tags` names the subjects (a page sends the item's subject tags; only the
 *  account's own follows count). Empty when the person follows none. */
async function feedItemsFor(db, { accountId, tags, subjects }) {
  const asked = new Set(tags);
  const mine = subjects.filter((s) => asked.has(s.tag));
  if (mine.length === 0) return { items: [], tags: [] };
  const toMs = Date.now();
  const built = await buildTimeline(db, mine, {
    fromMs: toMs - 7 * 86_400_000,
    toMs,
    accountId,
    interactive: true,
    // Home's feed leaves the account's administration out; so does this.
    accountLines: false,
    // Items only: no entry, so no late count to read.
    lateCounts: false,
  });
  return {
    items: (built.timeline ?? []).filter(cheerable),
    tags: mine.map((s) => s.tag),
  };
}

/** The item as the person's own feed holds it now, or null. With `posts`
 *  on (2026-11-17), a post the person may see is one too: its own read,
 *  no feed rebuilt (posts.mjs). */
export async function ownFeedItem(
  db,
  { accountId, itemId, tags, subjects, posts = false },
) {
  if (posts) {
    const post = await canSeePost(db, accountId, itemId, subjects);
    if (post) return post;
  }
  const { items } = await feedItemsFor(db, { accountId, tags, subjects });
  return items.find((it) => it.id === itemId) ?? null;
}

/** Whether an item is about someone else: none of the players it names
 *  is one of the account's own (its primary or an alt, any status).
 *  Cheerleader counts cheers on other people's items only (#1015). */
export async function aboutSomeoneElse(db, accountId, item) {
  const tags = itemSubjectTags(item);
  if (tags.length === 0) return true;
  const { rows } = await db.query(
    `select 1 from claim
      where account_id = $1::uuid and player_tag = any($2::text[])
        and (is_primary or relationship in ('primary', 'alt'))
      limit 1`,
    [accountId, tags],
  );
  return rows.length === 0;
}

/** When the person's cheer on an item was first given, as stored. */
export async function cheeredAt(db, accountId, itemId) {
  const { rows } = await db.query(
    `select created_at from timeline_cheer
      where account_id = $1::uuid and item_id = $2::text`,
    [accountId, itemId],
  );
  return rows[0]?.created_at ?? null;
}

/** The player tags an item is about: its subject and the players it
 *  names, at most eight. */
export function itemSubjectTags(item) {
  const tags = [
    item?.subject_tag,
    ...(item?.subjects ?? []).map((s) => s?.tag),
  ].filter((t) => typeof t === "string" && t);
  return [...new Set(tags)].slice(0, 8);
}

/** Set, change or take back the person's cheer on an item; `cheer` null
 *  takes it back. `item` (the item as the person's feed holds it) stamps
 *  whose item it is (0280), so the activity mail can find the accounts
 *  whose items had cheers. Answers the item's counts after the write. */
export async function setCheer(db, accountId, itemId, cheer, item = null) {
  if (cheer === null)
    await db.query(
      `delete from timeline_cheer where account_id = $1 and item_id = $2`,
      [accountId, itemId],
    );
  else
    await db.query(
      `insert into timeline_cheer (account_id, item_id, cheer, subject_tags)
       values ($1, $2, $3, $4::text[])
       on conflict (account_id, item_id)
       do update set cheer = excluded.cheer, updated_at = now(),
                     subject_tags = coalesce(excluded.subject_tags,
                                             timeline_cheer.subject_tags)`,
      // A post's cheer stamps no players (2026-11-17): the activity mail
      // and push find their accounts by these tags, and posts reach
      // neither; the web bell reads post cheers by the post itself.
      [
        accountId,
        itemId,
        cheer,
        item && item.kind !== "post" ? itemSubjectTags(item) : null,
      ],
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

/** The page's items that are in the reader's feed now, each with its
 *  cheers: `{ items: [{ id, kind, at, text, cheers, my_cheer }], subjects }`
 *  (the sentence in game names, as the feed says it; never a nickname). `subjects` are
 *  the tags the page sends back with a cheer (the follows the items came
 *  through). A player page asks for the player (followed, or through the
 *  clan they are in now); a battle page for the battle's players and their
 *  clans, keeping only the items that battle proves or that highlight it.
 *  Null when the page names nothing (an unknown battle). */
export async function cheersOnPage(
  db,
  { accountId, subjects, player, battle },
) {
  let tags;
  let about;
  if (player) {
    const { rows } = await db.query(
      `select clan_tag from clan_membership
        where player_tag = $1 and left_observed_at is null limit 1`,
      [player],
    );
    tags = [player, rows[0]?.clan_tag].filter(Boolean);
    about = (it) =>
      it.subject_tag === player ||
      (it.subjects ?? []).some((s) => s.tag === player);
  } else {
    const ids = await resolveBattleRef(db, battle, 2);
    if (ids.length !== 1) return null;
    const id = ids[0];
    const { rows } = await db.query(
      `select bp.player_tag, bp.clan_tag, cm.clan_tag as clan_now
         from battle_participant bp
         left join clan_membership cm on cm.player_tag = bp.player_tag
          and cm.left_observed_at is null
        where bp.battle_id = $1`,
      [id],
    );
    tags = [
      ...new Set(rows.flatMap((r) => [r.player_tag, r.clan_tag, r.clan_now])),
    ].filter(Boolean);
    about = (it) => it.facts?.battle?.battle_id === id || proofOf(it) === id;
  }
  const found = await feedItemsFor(db, { accountId, tags, subjects });
  const items = await withCheers(db, found.items.filter(about), accountId);
  return {
    items: items.map((it) => ({
      id: it.id,
      kind: it.kind,
      at: shownAt(it) || it.at || null,
      text: String(it.text ?? ""),
      cheers: it.cheers,
      my_cheer: it.my_cheer,
    })),
    subjects: found.tags,
  };
}

/** Your week's cheers (G4, 2026-11-12): how many cheers other people gave
 *  the items about your player since `fromMs` (Monday's reset), one number,
 *  never who. The items are rebuilt for the one player (the bell's way), so
 *  the count is of this week's items as anyone's feed shows them. */
export async function cheersReceived(db, accountId, tag, fromMs, toMs) {
  const built = await buildTimeline(
    db,
    [{ kind: "player", tag, relationship: "primary", nickname: null }],
    {
      fromMs,
      toMs,
      accountId,
      interactive: true,
      accountLines: false,
      // Items only: no entry, so no late count to read.
      lateCounts: false,
    },
  );
  const ids = (built.timeline ?? []).filter(cheerable).map((it) => it.id);
  if (ids.length === 0) return 0;
  const { rows } = await db.query(
    `select count(*)::int as n from timeline_cheer tc
      where item_id = any($1::text[]) and tc.account_id <> $2
        and not ${blockedSql("tc.account_id", "$2::uuid")}`,
    [ids, accountId],
  );
  return rows[0].n;
}
