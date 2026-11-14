/**
 * The social layer's account reads, shared by the player page
 * (services/web-api routes/player.mjs) and the MCP tool players_follows, so
 * both doors read one derivation.
 *
 * Follows and followers belong to an account, and an account is named by the
 * player it verified. A player no account has verified has no follows or
 * followers to show [engineering, 2026-11-12: the narrow reading]. A follower
 * is named by the player its account verified, game name and tag; an account
 * with no verified player is counted, never named. Never a nickname, an email
 * or a Discord username: that an account linked a Discord is a boolean.
 */

/** A follow list past this is cut, and the rest are counted. */
export const FOLLOW_LIST_CAP = 100;

/** The account that verified the player as itself: one at most, since
 *  verifying ends every other account's claim to be them (#556). People
 *  only; an agent never claims a player as itself. `{ account_id, discord }`
 *  or null. */
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

/** The profile images of the players in `tags` (2026-11-14): for each tag
 *  an account verified as itself (verifiedAccount's rule, read for a page
 *  of tags in one statement), the card that account chose, when it chose
 *  one. A tag nobody verified, or whose account chose none, is absent, and
 *  its avatar stays initials. The website's alone: no MCP tool and no
 *  `/api/v1` answer carries it. A `Map` of tag to card id. */
export async function verifiedAvatars(db, tags) {
  const list = [
    ...new Set((tags ?? []).filter((t) => typeof t === "string" && t)),
  ];
  if (list.length === 0) return new Map();
  const { rows } = await db.query(
    `select v.player_tag, v.avatar_card_id
       from (select distinct on (c.player_tag) c.player_tag, a.avatar_card_id
               from claim c join account a using (account_id)
              where c.player_tag = any($1::text[]) and c.status = 'verified'
                and (c.is_primary or c.relationship in ('primary', 'alt'))
                and coalesce(a.kind, 'person') = 'person'
              order by c.player_tag, c.verified_at) v
      where v.avatar_card_id is not null`,
    [list],
  );
  return new Map(rows.map((r) => [r.player_tag, r.avatar_card_id]));
}

/** Who the account follows: its friends (Home's Follow), by game name and
 *  tag. Watched players and its agents' players are not follows. */
export async function followsOf(db, accountId) {
  const { rows } = await db.query(
    `select c.player_tag as tag, p.name, count(*) over ()::int as total
       from claim c left join player p using (player_tag)
      where c.account_id = $1 and c.relationship = 'friend'
        and not c.is_primary
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
 *  by the player their account verified (game name and tag), the rest
 *  counted. The account that is the player is not its own follower. */
export async function followersOf(db, tag, selfAccountId) {
  const { rows } = await db.query(
    `select f.account_id, v.player_tag as tag, p.name
       from claim f
       join account a on a.account_id = f.account_id
       left join lateral (
         select c.player_tag from claim c
          where c.account_id = f.account_id and c.status = 'verified'
            and (c.is_primary or c.relationship in ('primary', 'alt'))
          order by c.is_primary desc, c.verified_at limit 1) v on true
       left join player p on p.player_tag = v.player_tag
      where f.player_tag = $1 and f.relationship = 'friend'
        and coalesce(a.kind, 'person') = 'person'
        and f.account_id is distinct from $2
      order by lower(coalesce(p.name, v.player_tag)) nulls last, v.player_tag`,
    [tag, selfAccountId],
  );
  const named = rows.filter((r) => r.tag);
  return {
    count: rows.length,
    players: named
      .slice(0, FOLLOW_LIST_CAP)
      .map((r) => ({ tag: r.tag, name: r.name ?? null })),
    unnamed: rows.length - Math.min(named.length, FOLLOW_LIST_CAP),
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
 * The person a social read is for (DECISIONS "Agents read the social layer
 * and never write it"): a person's own connection reads as that person; an
 * agent reads as its owner, when both are approved and the owner is a
 * person. Any other kind, and anything unapproved, reads as nobody: null.
 * Read from the database each time, never from a remembered account.
 */
export async function socialReader(db, account) {
  const kind = account?.kind ?? "person";
  if ((kind !== "person" && kind !== "agent") || !account?.accountId)
    return null;
  const { rows } = await db.query(
    `select case when a.kind = 'agent' then o.account_id else a.account_id end
              as account_id,
            a.kind
       from account a
       left join account o on o.account_id = a.owned_by_account_id
      where a.account_id = $1 and a.status = 'approved'
        and (coalesce(a.kind, 'person') = 'person'
             or (a.kind = 'agent' and o.kind = 'person'
                 and o.status = 'approved'))`,
    [account.accountId],
  );
  if (!rows[0]) return null;
  return {
    accountId: rows[0].account_id,
    asOwner: rows[0].kind === "agent",
  };
}

/** The reader's primary player, or null. */
export async function primaryOf(db, accountId) {
  const { rows } = await db.query(
    `select player_tag from claim where account_id = $1 and is_primary`,
    [accountId],
  );
  return rows[0]?.player_tag ?? null;
}
