/**
 * Blocks (2026-11-16; Jamie: "if we do that we need Block capabilities").
 * One person account blocks another, silently: the blocked person is
 * never told, and nobody else ever learns of it. A block is between
 * accounts; a player page or a comment names the account behind it.
 *
 * A block works both ways for what each sees of the other (neither sees
 * the other's comments, cheers, suggestions or bell lines), and it ends
 * the follows between them in both directions: the account follows and
 * the follows of each other's Verified players (linked follows). While it
 * stands, neither can follow the other again. The game record stays
 * public: anyone can still open a player's page and their battles, since
 * that is open game data, and a block cannot hide it.
 *
 * The filters that read blocks live with each reader (comments, cheers,
 * the bell, People). They all ask the one question this module answers:
 * which accounts is this one in a block with, either way.
 *
 * Blocks are private: read by those filters and by the blocker's own
 * Settings, never shown to anyone else and never over MCP.
 */
import { unfollowAccountLinked } from "./linked.mjs";

/** Blocks one account may hold: generous, and said when reached. */
export const BLOCK_MAX = 1000;

/** SQL true when accounts `$a` and `$b` are in a block either way. Takes
 *  two SQL expressions; a column must be qualified by its table's alias
 *  (`tc.account_id`), or inside the subquery it names account_block's own
 *  column (Codex on #1078). */
export const blockedSql = (a, b) =>
  `exists (select 1 from account_block ab
            where (ab.account_id = ${a} and ab.blocked_account_id = ${b})
               or (ab.account_id = ${b} and ab.blocked_account_id = ${a}))`;

/** Whether two accounts are in a block, either way. */
export async function blockedEitherWay(db, a, b) {
  if (!a || !b || a === b) return false;
  const { rows } = await db.query(
    `select ${blockedSql("$1::uuid", "$2::uuid")} as blocked`,
    [a, b],
  );
  return rows[0]?.blocked === true;
}

/** Every account in a block with `accountId`, either way: a Set of ids. */
export async function blockedWith(db, accountId) {
  if (!accountId) return new Set();
  const { rows } = await db.query(
    `select blocked_account_id as id from account_block where account_id = $1
     union
     select account_id from account_block where blocked_account_id = $1`,
    [accountId],
  );
  return new Set(rows.map((r) => r.id));
}

/** The approved person account a page id names, or null. */
export async function accountOfPage(db, pageId) {
  if (typeof pageId !== "string" || !/^[a-km-np-z2-9]{12}$/.test(pageId))
    return null;
  const { rows } = await db.query(
    `select a.account_id from account_passport ap
       join account a on a.account_id = ap.account_id
                     and a.kind = 'person' and a.status = 'approved'
      where ap.passport_id = $1`,
    [pageId],
  );
  return rows[0]?.account_id ?? null;
}

/**
 * Block an account: the row, then the follows between them end, both
 * ways. Idempotent. Returns `{ ok, added }` or `{ error }`
 * ("self", "not_found", "too_many").
 */
export async function blockAccount(db, account, targetId) {
  const me = account.accountId;
  if (!targetId) return { error: "not_found" };
  if (targetId === me) return { error: "self" };
  const { rows: target } = await db.query(
    `select 1 from account where account_id = $1 and kind = 'person'`,
    [targetId],
  );
  if (!target.length) return { error: "not_found" };
  const { rows: held } = await db.query(
    `select count(*)::int as n from account_block where account_id = $1`,
    [me],
  );
  const { rows: added } = await db.query(
    `insert into account_block (account_id, blocked_account_id)
     select $1, $2 where $3::int < ${BLOCK_MAX}
     on conflict do nothing returning 1`,
    [me, targetId, held[0].n],
  );
  if (!added.length) {
    const { rows: has } = await db.query(
      `select 1 from account_block
        where account_id = $1 and blocked_account_id = $2`,
      [me, targetId],
    );
    if (!has.length) return { error: "too_many" };
  }
  // The follows end both ways. The blocker's own unfollow is logged in
  // their history; the blocked person's is quiet, so their history never
  // shows an unfollow they did not make.
  await unfollowAccountLinked(db, account, targetId, { via: "block" });
  await unfollowAccountLinked(db, { accountId: targetId }, me, {
    via: "block",
    quiet: true,
  });
  return { ok: true, added: added.length > 0 };
}

/** Unblock: the row goes. Follows ended by the block stay ended. */
export async function unblockAccount(db, account, targetId) {
  const { rowCount } = await db.query(
    `delete from account_block where account_id = $1 and blocked_account_id = $2`,
    [account.accountId, targetId],
  );
  return { ok: true, removed: rowCount > 0 };
}

/** The accounts this one has blocked, newest first, as Settings lists
 *  them: page id, primary player's name and tag, and when. Never the
 *  accounts that blocked this one. */
export async function listBlocks(db, accountId) {
  const { rows } = await db.query(
    `select ap.passport_id as account_id, pc.player_tag, pp.name, ab.created_at
       from account_block ab
       left join account_passport ap on ap.account_id = ab.blocked_account_id
       left join claim pc on pc.account_id = ab.blocked_account_id and pc.is_primary
       left join player pp on pp.player_tag = pc.player_tag
      where ab.account_id = $1
      order by ab.created_at desc`,
    [accountId],
  );
  return rows.map((r) => ({
    account_id: r.account_id ?? null,
    player_tag: r.player_tag ?? null,
    name: r.name ?? null,
    blocked_at: r.created_at ? new Date(r.created_at).toISOString() : null,
  }));
}
