/**
 * Linked follows (Jamie, 2026-11-15): "if you follow a player you also
 * follow the account. If you follow the account you follow ALL players
 * that account has." Approved as: a Verified player's follow is its
 * account's follow; an account follow covers the account's Verified
 * players now and later; Claimed and Imported players stay player-only.
 *
 * One follow, kept in step:
 *
 * - Following a Verified player follows the account that verified it, and
 *   every other player that account has verified.
 * - Following an account follows each of its Verified players.
 * - When the account verifies another player, each of its followers
 *   follows that one too.
 * - Unfollowing the account, or one of its Verified players, ends it all:
 *   the account follow and every follow of its Verified players.
 *
 * A Claimed player never links an account: anyone can claim any player,
 * so a claim must not gather followers for whoever made it. Only the
 * verifier is linked, and only Verified players are followed through it.
 *
 * Each player follow is an ordinary friend claim written by addPlayer, so
 * the slots, the recording, MCP and the digest see nothing new. A player
 * the follow cannot take (no free slot, or no player of the reader's own
 * yet) is skipped, and the bell says so: one `follow_skipped` line per
 * player. The tapped player is never skipped: its own refusal is the
 * answer.
 *
 * addPlayer and removePlayer each run their own transaction, so these
 * run between them, never inside one.
 */
import { blockedEitherWay } from "./blocks.mjs";
import { addPlayer, removePlayer } from "./index.mjs";
import { settleCloseLink } from "./close.mjs";

/** Accounts one person may follow: generous, and said when reached. */
export const ACCOUNT_FOLLOW_MAX = 500;

const SELF = `(c.is_primary or c.relationship in ('primary', 'alt'))`;

/** The approved person account that verified `tag`, or null. */
export async function verifierOf(db, tag) {
  const { rows } = await db.query(
    `select c.account_id from claim c
       join account a on a.account_id = c.account_id
                     and a.kind = 'person' and a.status = 'approved'
      where c.player_tag = $1 and c.status = 'verified' and ${SELF}
      limit 1`,
    [tag],
  );
  return rows[0]?.account_id ?? null;
}

/** The players an account has verified, its primary first. */
export async function verifiedPlayersOf(db, accountId) {
  const { rows } = await db.query(
    `select c.player_tag from claim c
      where c.account_id = $1 and c.status = 'verified' and ${SELF}
      order by c.is_primary desc, c.verified_at, c.player_tag`,
    [accountId],
  );
  return rows.map((r) => r.player_tag);
}

/** The accounts that follow `accountId`. */
export async function accountFollowersOf(db, accountId) {
  const { rows } = await db.query(
    `select f.account_id from account_follow f
       join account a on a.account_id = f.account_id
                     and a.kind = 'person' and a.status = 'approved'
      where f.followed_account_id = $1
      order by f.created_at, f.account_id`,
    [accountId],
  );
  return rows.map((r) => r.account_id);
}

async function follows(db, readerId, ownerId) {
  const { rows } = await db.query(
    `select 1 from account_follow
      where account_id = $1 and followed_account_id = $2`,
    [readerId, ownerId],
  );
  return rows.length > 0;
}

async function isPerson(db, accountId) {
  const { rows } = await db.query(
    `select kind = 'person' as person from account where account_id = $1`,
    [accountId],
  );
  return rows[0]?.person === true;
}

/** The page id an account event names an account by (never its UUID). */
const PAGE_ID_SQL = `(select passport_id from account_passport
                       where account_id = $2)`;

async function pageIdOf(db, accountId) {
  const { rows } = await db.query(
    `select passport_id from account_passport where account_id = $1`,
    [accountId],
  );
  return rows[0]?.passport_id ?? null;
}

async function logEvent(db, accountId, kind, detail) {
  await db.query(
    `insert into account_event (account_id, kind, detail) values ($1, $2, $3)`,
    [accountId, kind, JSON.stringify(detail)],
  );
}

/**
 * The account follow itself: idempotent, refused past the cap. Returns
 * `{ ok, added }` or `{ error: "self" | "too_many" | "not_found" }`
 * (not_found: a block stands between them, said as nothing to follow).
 */
async function writeAccountFollow(db, readerId, ownerId, via) {
  if (readerId === ownerId) return { error: "self" };
  // A block, either way, means no follow between them (blocks.mjs). The
  // refusal reads as not found: the reader is never told of a block.
  if (await blockedEitherWay(db, readerId, ownerId))
    return { error: "not_found" };
  await db.query("begin");
  try {
    await db.query(
      `select account_id from account where account_id = $1 for update`,
      [readerId],
    );
    const { rows } = await db.query(
      `select count(*)::int as n from account_follow where account_id = $1`,
      [readerId],
    );
    const { rows: added } = await db.query(
      `insert into account_follow (account_id, followed_account_id)
       select $1, $2 where $3::int < ${ACCOUNT_FOLLOW_MAX}
       on conflict do nothing
       returning ${PAGE_ID_SQL} as page_id`,
      [readerId, ownerId, rows[0].n],
    );
    if (!added.length && !(await follows(db, readerId, ownerId))) {
      await db.query("rollback");
      return { error: "too_many" };
    }
    if (added.length)
      await logEvent(db, readerId, "account_followed", {
        account_id: added[0].page_id,
        via,
      });
    await db.query("commit");
    return { ok: true, added: added.length > 0 };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/** Follow one of the account's Verified players for a reader; a refusal
 *  becomes a bell line, never an error. */
async function followThrough(db, readerId, ownerId, tag, via) {
  const r = await addPlayer(
    db,
    { accountId: readerId },
    { tag, makePrimary: false, follow: true, via },
  );
  if (r.ok) return { tag, ok: true, added: r.added, slot: r.slot };
  const reason =
    r.error === "quota_exceeded"
      ? "no_free_slot"
      : r.error === "no_own_player"
        ? "no_own_player"
        : r.error;
  await logEvent(db, readerId, "follow_skipped", {
    player_tag: tag,
    account_id: await pageIdOf(db, ownerId),
    reason,
    via,
  });
  return { tag, ok: false, reason };
}

/**
 * Follow an account and every player it has verified. `first`, when set,
 * is a player the reader has just followed (it is not followed again).
 * Returns `{ ok, account_added, followed: [tag], skipped: [{tag, reason}] }`
 * or `{ error }`.
 */
export async function followAccountLinked(
  db,
  account,
  ownerId,
  { via, first = null } = {},
) {
  const readerId = account.accountId;
  if (!(await isPerson(db, readerId))) return { error: "not_entitled" };
  const wrote = await writeAccountFollow(db, readerId, ownerId, via);
  if (wrote.error) return wrote;
  const followed = [];
  const skipped = [];
  // The players the reader already follows (or is) need nothing.
  for (const tag of await linkedTagsToFollow(db, readerId, ownerId, first)) {
    const r = await followThrough(db, readerId, ownerId, tag, via);
    if (r.ok) followed.push(tag);
    else skipped.push({ tag, reason: r.reason });
  }
  // A close friend's link keeps one mark (close.mjs).
  if (followed.length || first) await settleCloseLink(db, readerId, ownerId);
  return { ok: true, account_added: wrote.added, followed, skipped };
}

/**
 * Stop following an account: the account follow and each follow of its
 * Verified players. A player the reader claims as their own is left alone.
 * Idempotent. Returns
 * `{ ok, account_removed, unfollowed: [tag] }`.
 */
export async function unfollowAccountLinked(
  db,
  account,
  ownerId,
  { via, quiet = false },
) {
  const readerId = account.accountId;
  const { rows: gone } = await db.query(
    `delete from account_follow
      where account_id = $1 and followed_account_id = $2
      returning ${PAGE_ID_SQL} as page_id`,
    [readerId, ownerId],
  );
  // `quiet`: a block ends the blocked person's follow, and their own
  // history must not show an unfollow they never made (blocks.mjs).
  if (gone.length && !quiet)
    await logEvent(db, readerId, "account_unfollowed", {
      account_id: gone[0].page_id,
      via,
    });
  const tags = await verifiedPlayersOf(db, ownerId);
  const { rows: friends } = await db.query(
    `select player_tag from claim
      where account_id = $1 and player_tag = any($2::text[])
        and relationship = 'friend' and not is_primary`,
    [readerId, tags],
  );
  const unfollowed = [];
  for (const { player_tag: tag } of friends) {
    const r = await removePlayer(db, account, { tag, via });
    if (r.removed) unfollowed.push(tag);
  }
  return { ok: true, account_removed: gone.length > 0, unfollowed };
}

/**
 * After a person's follow of `tag` committed: when `tag` is Verified by
 * another account, follow that account and its other Verified players.
 * Null when the player links nothing (Claimed, Imported, the reader's own,
 * or not a friend follow).
 */
export async function linkAfterFollow(db, account, tag, { via }) {
  const { rows } = await db.query(
    `select relationship from claim where account_id = $1 and player_tag = $2`,
    [account.accountId, tag],
  );
  if (rows[0]?.relationship !== "friend") return null;
  const ownerId = await verifierOf(db, tag);
  if (!ownerId || ownerId === account.accountId) return null;
  const r = await followAccountLinked(db, account, ownerId, {
    via,
    first: tag,
  });
  return r.ok ? r : null;
}

/**
 * Unfollow a player, linked: when the reader follows the account that
 * verified it, the whole link ends (the account and all its Verified
 * players). Otherwise the one player, as removePlayer. Returns
 * removePlayer's result, with `unlinked` when an account follow ended.
 */
export async function unfollowPlayerLinked(db, account, { tag, via }) {
  const ownerId = await verifierOf(db, tag);
  if (ownerId && ownerId !== account.accountId) {
    const { rows } = await db.query(
      `select relationship from claim where account_id = $1 and player_tag = $2`,
      [account.accountId, tag],
    );
    if (
      rows[0]?.relationship === "friend" &&
      (await follows(db, account.accountId, ownerId))
    ) {
      const r = await unfollowAccountLinked(db, account, ownerId, { via });
      return {
        removed: r.unfollowed.includes(tag),
        recordingStopped: false,
        promotedPrimary: null,
        unlinked: r,
      };
    }
  }
  return removePlayer(db, account, { tag, via });
}

/**
 * After `ownerId` verified `tag`, both sides of the link catch up ("now
 * and later"): every account following them follows the new player, and
 * every person who already followed the player (while it was Claimed or
 * Imported) now follows the account and its other Verified players.
 * Skips become bell lines. Returns `{ followed, skipped, linked }`
 * counts: players followed, players skipped, player followers linked.
 */
export async function linkNewVerified(
  db,
  ownerId,
  tag,
  { via = "linked" } = {},
) {
  let followed = 0;
  let skipped = 0;
  let linked = 0;
  for (const readerId of await accountFollowersOf(db, ownerId)) {
    // A follower who already has this player needs nothing.
    if (!(await linkedTagsToFollow(db, readerId, ownerId)).includes(tag))
      continue;
    const r = await followThrough(db, readerId, ownerId, tag, via);
    if (r.ok) {
      followed += 1;
      await settleCloseLink(db, readerId, ownerId);
    } else skipped += 1;
  }
  const { rows } = await db.query(
    `select c.account_id from claim c
       join account a on a.account_id = c.account_id
                     and a.kind = 'person' and a.status = 'approved'
      where c.player_tag = $1 and c.relationship = 'friend'
        and not c.is_primary and c.account_id <> $2
        and not exists (
          select 1 from account_follow f
           where f.account_id = c.account_id and f.followed_account_id = $2)
        and not exists (
          select 1 from account_block ab
           where (ab.account_id = c.account_id and ab.blocked_account_id = $2)
              or (ab.account_id = $2 and ab.blocked_account_id = c.account_id))
      order by c.account_id`,
    [tag, ownerId],
  );
  // A person in a block with the new owner stops following the player
  // now theirs, as the block would have ended it (blocks.mjs).
  const { rows: barred } = await db.query(
    `select c.account_id from claim c
      where c.player_tag = $1 and c.relationship = 'friend'
        and not c.is_primary and c.account_id <> $2
        and exists (
          select 1 from account_block ab
           where (ab.account_id = c.account_id and ab.blocked_account_id = $2)
              or (ab.account_id = $2 and ab.blocked_account_id = c.account_id))`,
    [tag, ownerId],
  );
  for (const { account_id: readerId } of barred)
    await removePlayer(db, { accountId: readerId }, { tag, via: "linked" });
  for (const { account_id: readerId } of rows) {
    const r = await followAccountLinked(db, { accountId: readerId }, ownerId, {
      via,
      first: tag,
    });
    if (!r.ok) continue;
    linked += 1;
    followed += r.followed.length;
    skipped += r.skipped.length;
  }
  return { followed, skipped, linked };
}

/**
 * What following `ownerId` would add for a reader, before the tap: the
 * account's Verified players the reader does not follow yet, apart from
 * `except` (the player being tapped, priced on its own).
 */
export async function linkedTagsToFollow(db, readerId, ownerId, except = null) {
  const tags = (await verifiedPlayersOf(db, ownerId)).filter(
    (t) => t !== except,
  );
  if (!tags.length) return [];
  const { rows } = await db.query(
    `select player_tag from claim
      where account_id = $1 and player_tag = any($2::text[])
        and (relationship = 'friend' or is_primary
             or relationship in ('primary', 'alt'))`,
    [readerId, tags],
  );
  const have = new Set(rows.map((r) => r.player_tag));
  return tags.filter((t) => !have.has(t));
}
