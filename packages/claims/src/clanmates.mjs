/** Automatic member connections are observed current roster facts. They are
 * never claims, follows, recording reasons, quota or notification settings. */
import { blockedSql, visibleFriendSql } from "./blocks.mjs";

const parameter = (value) => {
  if (!/^\$[1-9][0-9]*$/.test(value)) throw new Error("Expected SQL parameter");
  return value;
};
/** The roster owns membership. Its precise projection stamp wins over older
 * profiles; newer explicit absence, a move or unresolved evidence closes
 * current membership until a confirming observation arrives. This is public
 * game evidence, independent of the viewing account and social blocks; it
 * does not authorize private Clan roles or actions. */
export function currentRosterSql(alias, projectedAt) {
  const rosterAt = `greatest(${alias}.joined_observed_at, coalesce(${projectedAt}, ${alias}.joined_observed_at))`;
  return `${alias}.left_observed_at is null
    and ${alias}.joined_observed_at <= now()
    and ${rosterAt} <= now()
    and not exists (
      select 1 from player_profile_membership profile
       where profile.player_tag=${alias}.player_tag
         and profile.observed_at >= ${rosterAt}
         and (profile.observed_at > now() or profile.state <> 'member'
           or profile.clan_tag is distinct from ${alias}.clan_tag
           or profile.clan_observed_at is distinct from profile.observed_at))
    and not exists (
      select 1 from poll_state admitted
       where admitted.subject_tag=${alias}.player_tag and admitted.endpoint='player'
         and admitted.last_admitted_at > ${rosterAt}
         and not exists (select 1 from player_profile_membership projected
                          where projected.player_tag=${alias}.player_tag
                            and projected.observed_at >= admitted.last_admitted_at))`;
}

/** A person's verified primary and alts can each establish a current clan.
 * A followed clan, historical tenure or retained last-known tag cannot. */
export function currentOwnClansSql(accountSql = "$1") {
  const account = parameter(accountSql);
  return `select distinct cm.clan_tag, clan.name, clan.roster_observed_at
    from account reader
    join claim own on own.account_id=reader.account_id
    join clan_membership cm on cm.player_tag=own.player_tag
    join clan on clan.clan_tag=cm.clan_tag
   where reader.account_id=${account}::uuid and reader.kind='person' and reader.status='approved'
     and own.status='verified' and (own.is_primary or own.relationship in ('primary','alt'))
     and ${currentRosterSql("cm", "clan.roster_observed_at")}`;
}

/** Embeddable keyed source, shared by member readers and the Timeline.
 * Includes voluntary friends too; callers union identities, never duplicate
 * stories. Blocks are checked against a tag's verified owner both ways. */
export function currentClanPlayersSql(
  accountSql = "$1",
  { tagsSql = null, names = true } = {},
) {
  const account = parameter(accountSql);
  const tags = tagsSql ? parameter(tagsSql) : null;
  return `with own_clans as materialized (${currentOwnClansSql(account)})
    select cm.player_tag, ${names ? "p.name" : "null::text as name"}, cm.clan_tag, clans.name as clan_name, cm.role
      from own_clans clans
      join clan_membership cm on cm.clan_tag=clans.clan_tag
      ${names ? "join player p on p.player_tag=cm.player_tag" : ""}
     where ${tags ? `cm.player_tag=any(${tags}::text[]) and` : ""} ${currentRosterSql("cm", "clans.roster_observed_at")}
       and not exists (select 1 from claim owner
                        where owner.player_tag=cm.player_tag and owner.status='verified'
                          and (owner.is_primary or owner.relationship in ('primary','alt'))
                          and ${blockedSql(account + "::uuid", "owner.account_id")})`;
}

/** The social counterpart excludes all of the reader's own claims. */
export function clanmatePlayersSql(accountSql = "$1", options = {}) {
  const account = parameter(accountSql);
  return `select mates.* from (${currentClanPlayersSql(account, options)}) mates
    where not exists (select 1 from claim self where self.account_id=${account}::uuid
                       and self.player_tag=mates.player_tag
                       and (self.is_primary or self.relationship in ('primary','alt')))`;
}

export async function currentClanmates(db, accountId, { tags = null } = {}) {
  if (Array.isArray(tags) && tags.length === 0) return new Map();
  const { rows } = await db.query(
    `select mates.*, (held.relationship='friend' and not held.is_primary) is true as friend, held.close is true as close
       from (${clanmatePlayersSql("$1", { tagsSql: tags ? "$2" : null })}) mates
       left join claim held on held.account_id=$1::uuid and held.player_tag=mates.player_tag
      ${tags ? "where mates.player_tag=any($2::text[])" : ""}
      order by lower(coalesce(mates.name,mates.player_tag)),mates.player_tag`,
    tags ? [accountId, [...new Set(tags)]] : [accountId],
  );
  return new Map(
    rows.map(({ friend, close, ...row }) => [
      row.player_tag,
      {
        ...row,
        ...connectionOf({ ...row, friend, close }),
      },
    ]),
  );
}

/** One canonical member display relationship. Stored claims remain intact;
 * an explicit Friend/Close wins over an automatic Clanmate. */
export async function playerConnections(db, accountId, tags) {
  const wanted = [...new Set(tags.filter(Boolean))];
  if (!wanted.length) return new Map();
  const { rows } = await db.query(
    `with mates as materialized (${clanmatePlayersSql("$1", { tagsSql: "$2", names: false })}), wanted as (
       select unnest($2::text[]) as player_tag)
     select wanted.player_tag,
            (held.is_primary or held.relationship in ('primary','alt')) is true as self,
            (case when mates.player_tag is not null then held.relationship='friend' and not held.is_primary
                  else ${visibleFriendSql("held")} end) is true as friend,
            held.close is true as close, mates.clan_tag, mates.clan_name
       from wanted
       left join claim held on held.account_id=$1::uuid and held.player_tag=wanted.player_tag
       left join mates on mates.player_tag=wanted.player_tag`,
    [accountId, wanted],
  );
  return new Map(rows.map((row) => [row.player_tag, connectionOf(row)]));
}

function connectionOf(row) {
  return {
    connection: row.self
      ? "self"
      : row.friend
        ? "friend"
        : row.clan_tag
          ? "clanmate"
          : null,
    clanmate: row.self ? null : (row.clan_tag ?? null),
    shared_clan:
      !row.self && row.clan_tag
        ? { clan_tag: row.clan_tag, name: row.clan_name ?? null }
        : null,
    close: !row.self && row.friend && row.close,
  };
}
