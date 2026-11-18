/** Member-only relationship decoration. Stored claims, recording controls and
 * public tool contracts retain their existing meanings. */
import { blockedSql, playerConnections } from "@elixir-mcp/claims";

export async function withPlayerConnections(db, accountId, out) {
  const keys = ["people", "players", "entries", "matches", "clanmates"].filter(
    (k) => Array.isArray(out?.[k]),
  );
  const tagOf = (p) => p?.tag ?? p?.player_tag;
  const connections = await playerConnections(
    db,
    accountId,
    keys.flatMap((k) =>
      out[k].filter((p) => !Object.hasOwn(p, "connection")).map(tagOf),
    ),
  );
  const next = { ...out };
  for (const k of keys)
    next[k] = out[k].map((p) => ({ ...p, ...connections.get(tagOf(p)) }));
  return next;
}

/** Only verified players establish an account's automatic connection. An
 * unverified claim cannot borrow somebody else's current clan membership. */
export async function accountConnections(db, readerId, pageIds) {
  const ids = [...new Set(pageIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `select ap.passport_id, a.account_id, v.player_tag,
            exists(select 1 from account_follow af where af.account_id=$1 and af.followed_account_id=a.account_id) as following,
            ${blockedSql("$1::uuid", "a.account_id")} as blocked
       from account_passport ap join account a on a.account_id=ap.account_id
       left join claim v on v.account_id=a.account_id and v.status='verified'
        and (v.is_primary or v.relationship in ('primary','alt'))
      where ap.passport_id=any($2::text[]) and a.kind='person' and a.status='approved'
      order by ap.passport_id,v.is_primary desc,v.player_tag`,
    [readerId, ids],
  );
  const players = await playerConnections(
    db,
    readerId,
    rows.map((r) => r.player_tag),
  );
  const out = new Map();
  for (const row of rows) {
    const self = row.account_id === readerId;
    const p = !row.blocked && !self ? players.get(row.player_tag) : null;
    const previous = out.get(row.passport_id);
    const shared = previous?.shared_clan ?? p?.shared_clan ?? null;
    const friend =
      !row.blocked &&
      (row.following ||
        p?.connection === "friend" ||
        previous?.connection === "friend");
    out.set(row.passport_id, {
      connection: self
        ? "self"
        : friend
          ? "friend"
          : shared
            ? "clanmate"
            : null,
      clanmate: shared?.clan_tag ?? null,
      shared_clan: shared,
      close: !self && friend && (p?.close === true || previous?.close === true),
    });
  }
  return out;
}
