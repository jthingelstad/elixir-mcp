/**
 * Close friends (Jamie, 2026-11-16: "a way to show close friends versus
 * just follows"). A close friend is a private mark on a friend follow,
 * `claim.close` (0281): the account that set it is the only one that ever
 * reads it. The other person is never told; no player page, account page,
 * follow list, bell line, mail or MCP tool carries it.
 *
 * A linked follow (0277, linked.mjs) is one follow of an account and its
 * Verified players, so its players never disagree about the mark: marking
 * or unmarking one of them marks or unmarks every friend follow the reader
 * has of that account's Verified players, and a player the link follows
 * later takes the mark the others carry (settleCloseLink).
 *
 * Only a friend follow carries it. Your own players and the players you
 * watch are not friends, and 0281's check refuses the mark on them; a
 * relationship change away from friend clears it (index.mjs).
 *
 * No account_event is written: the account's own lines reach its bell and
 * timeline, and a mark is not news, even to its owner.
 */

/** Your own players in an account's claims, as linked.mjs reads them. */
const SELF = `(c.is_primary or c.relationship in ('primary', 'alt'))`;

/** The players `ownerId` has verified, as a subquery on $2. */
const THEIR_VERIFIED = `select c.player_tag from claim c
  where c.account_id = $2 and c.status = 'verified' and ${SELF}`;

/**
 * Mark or unmark a player you follow as a close friend. When the reader
 * follows the account that verified the player, every friend follow of
 * that account's Verified players takes the same mark. Returns
 * `{ ok, close, tags }` (the players whose mark is now `close`) or
 * `{ error: "not_found" | "not_a_friend" }`.
 */
export async function setClose(db, account, { tag, close }) {
  const readerId = account.accountId;
  const { rows } = await db.query(
    `select relationship, is_primary from claim
      where account_id = $1 and player_tag = $2`,
    [readerId, tag],
  );
  if (!rows[0]) return { error: "not_found" };
  if (rows[0].relationship !== "friend" || rows[0].is_primary)
    return { error: "not_a_friend" };
  // The account that verified the player, when the reader follows it: the
  // link's players move together.
  const { rows: owner } = await db.query(
    `select c.account_id from claim c
       join account a on a.account_id = c.account_id
                     and a.kind = 'person' and a.status = 'approved'
       join account_follow f on f.followed_account_id = c.account_id
                            and f.account_id = $2
      where c.player_tag = $1 and c.status = 'verified' and ${SELF}
        and c.account_id <> $2
      limit 1`,
    [tag, readerId],
  );
  const ownerId = owner[0]?.account_id ?? null;
  const { rows: marked } = ownerId
    ? await db.query(
        `update claim set close = $3
          where account_id = $1 and relationship = 'friend' and not is_primary
            and player_tag in (${THEIR_VERIFIED})
          returning player_tag`,
        [readerId, ownerId, close === true],
      )
    : await db.query(
        `update claim set close = $3
          where account_id = $1 and player_tag = $2
            and relationship = 'friend' and not is_primary
          returning player_tag`,
        [readerId, tag, close === true],
      );
  return {
    ok: true,
    close: close === true,
    tags: marked.map((r) => r.player_tag).sort(),
  };
}

/**
 * After a linked follow took a player (linked.mjs): when any of the
 * reader's friend follows of `ownerId`'s Verified players is a close
 * friend, all of them are. Unmarking is never done here: only the reader's
 * own tap unmarks. Returns how many follows took the mark.
 */
export async function settleCloseLink(db, readerId, ownerId) {
  const { rowCount } = await db.query(
    `with mine as (
       select c.player_tag, c.close from claim c
        where c.account_id = $1 and c.relationship = 'friend'
          and not c.is_primary and c.player_tag in (${THEIR_VERIFIED}))
     update claim set close = true
      where account_id = $1 and not close
        and player_tag in (select player_tag from mine)
        and exists (select 1 from mine where close)`,
    [readerId, ownerId],
  );
  return rowCount;
}
