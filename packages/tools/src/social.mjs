import { visibleFriendSql } from "@elixir-mcp/claims";
import { verifiedPlayerIdentities } from "@elixir-mcp/auth/player-identities";
export { verifiedPlayerIdentities };
/**
 * The social layer's account reads, shared by the player page
 * (services/web-api routes/player.mjs) and the MCP tool players_follows, so
 * both doors read one derivation.
 *
 * Follows and followers belong to an account, and an account is named by the
 * player it verified. A player no account has verified has no follows or
 * followers to show [engineering, 2026-11-12: the narrow reading]. A follower
 * is named by the player its account verified, game name and tag, else by
 * the player it claims, marked unverified; an account with no player at all
 * is counted, never named (followersOf). Never a nickname, an email
 * or a Discord username: that an account linked a Discord is a boolean.
 */

/** A follow list past this is cut, and the rest are counted. */
export const FOLLOW_LIST_CAP = 100;

/** The account that verified the player as itself: one at most, since
 *  verifying ends every other account's claim to be them (#556). People
 *  only. `{ account_id, discord }` or null. */
export async function verifiedAccount(db, tag) {
  const { rows } = await db.query(
    `select c.account_id,
            exists (select 1 from account_discord d
                     where d.account_id = c.account_id) as discord
       from claim c join account a using (account_id)
      where c.player_tag = $1 and c.status = 'verified'
        and (c.is_primary or c.relationship in ('primary', 'alt'))
        and coalesce(a.kind, 'person') = 'person'
      order by c.verified_at limit 1`,
    [tag],
  );
  return rows[0] ?? null;
}

/** Existing image-only callers keep their contract. Verification is independent
 * of whether the account has chosen art. Both reads use the same proof rule. */
export async function verifiedAvatars(db, tags) {
  const identities = await verifiedPlayerIdentities(db, tags);
  return new Map(
    [...identities]
      .filter(([, p]) => p.avatar_card_id != null)
      .map(([tag, p]) => [tag, p.avatar_card_id]),
  );
}

/** Who the account follows: its friends (Home's Follow), by game name and
 *  A block with a player's verified owner hides that social association. */
export async function followsOf(db, accountId) {
  const { rows } = await db.query(
    `select c.player_tag as tag, p.name, count(*) over ()::int as total
       from claim c left join player p using (player_tag)
      where c.account_id = $1 and ${visibleFriendSql("c")}
      order by lower(coalesce(p.name, c.player_tag)), c.player_tag
      limit $2`,
    [accountId, FOLLOW_LIST_CAP],
  );
  return {
    count: rows[0]?.total ?? 0,
    players: rows.map((r) => ({ tag: r.tag, name: r.name ?? null })),
  };
}

/** Who follows the player: people with a friend claim on them, each named
 *  by the player their account verified (game name and tag, `verified:
 *  true`), else by the player it claims to be and has not verified
 *  (`verified: false`: the claim is all it says, never proof). An account
 *  with neither is counted in `no_player`, never named. A claim on a tag
 *  another account verified names nobody: that account is the player. The
 *  account that is the player is not its own follower [Jamie, 2026-11-14:
 *  unverified followers are shown as the player they claim]. */
export async function followersOf(db, tag, selfAccountId) {
  const { rows } = await db.query(
    `select f.account_id, v.player_tag as tag, p.name, v.verified
       from claim f
       join account a on a.account_id = f.account_id
       left join lateral (
         select c.player_tag, c.status = 'verified' as verified from claim c
          where c.account_id = f.account_id
            and (c.is_primary or c.relationship in ('primary', 'alt'))
            and (c.status = 'verified' or not exists (
                  select 1 from claim o
                   where o.player_tag = c.player_tag and o.status = 'verified'
                     and o.account_id <> c.account_id))
          order by c.status = 'verified' desc, c.is_primary desc,
                   c.verified_at, c.created_at
          limit 1) v on true
       left join player p on p.player_tag = v.player_tag
      where f.player_tag = $1 and ${visibleFriendSql("f")}
        and coalesce(a.kind, 'person') = 'person'
        and f.account_id is distinct from $2
      order by lower(coalesce(p.name, v.player_tag)) nulls last, v.player_tag`,
    [tag, selfAccountId],
  );
  const named = rows.filter((r) => r.tag);
  const listed = Math.min(named.length, FOLLOW_LIST_CAP);
  return {
    count: rows.length,
    players: named.slice(0, FOLLOW_LIST_CAP).map((r) => ({
      tag: r.tag,
      name: r.name ?? null,
      verified: r.verified === true,
    })),
    no_player: rows.length - named.length,
    unnamed: rows.length - listed,
  };
}

/** The player's social facts as the player page shows them: the badges of
 *  the account that verified the player, and that account's follows and
 *  followers (null when no account verified the player). */
export async function socialOf(db, tag) {
  const self = await verifiedAccount(db, tag);
  return {
    badges: {
      verified_player: Boolean(self),
      // That the account linked a Discord, never which.
      discord: self?.discord === true,
    },
    follows: self ? await followsOf(db, self.account_id) : null,
    followers: self ? await followersOf(db, tag, self.account_id) : null,
  };
}

/**
 * The person a social read is for: an approved person reads as
 * themselves. Any other kind, and anything unapproved, reads as nobody:
 * null. Read from the database each time, never from a remembered account.
 */
export async function socialReader(db, account) {
  if ((account?.kind ?? "person") !== "person" || !account?.accountId)
    return null;
  const { rows } = await db.query(
    `select account_id from account
      where account_id = $1 and status = 'approved'
        and coalesce(kind, 'person') = 'person'`,
    [account.accountId],
  );
  return rows[0] ? { accountId: rows[0].account_id } : null;
}

/** The reader's primary player, or null. */
export async function primaryOf(db, accountId) {
  const { rows } = await db.query(
    `select player_tag from claim where account_id = $1 and is_primary`,
    [accountId],
  );
  return rows[0]?.player_tag ?? null;
}
