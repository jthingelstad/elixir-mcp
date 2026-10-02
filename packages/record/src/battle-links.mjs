/** A battle's public link (2026-10-01): one read shared by battles_query,
 *  the mail and the public battle page, so every surface hands a person
 *  the same /battle/<short id> for a battle.
 *
 *  A short id is the battle_id's first 12 hex characters, longer only
 *  where another recorded battle shares them. Both reads walk the
 *  battle table's primary key: hex ids sort the same under the
 *  database's collation as byte for byte, so a prefix is a key range and
 *  the ids beside one in order are the ones that share most of it. */
import {
  battleShortId,
  battleShortLength,
  battleUrl,
  parseBattleRef,
} from "@elixir-mcp/contracts";

/** Map battle_id -> { short_id, url } for the given battles. */
export async function battleLinks(db, battleIds) {
  const ids = [...new Set(battleIds.filter(Boolean).map(String))];
  const out = new Map();
  if (ids.length === 0) return out;
  const { rows } = await db.query(
    `select x.id,
            (select b.battle_id from battle b where b.battle_id < x.id
              order by b.battle_id desc limit 1) as prev,
            (select b.battle_id from battle b where b.battle_id > x.id
              order by b.battle_id limit 1) as next
       from unnest($1::text[]) as x(id)`,
    [ids],
  );
  for (const r of rows) {
    const short = battleShortId(
      r.id,
      battleShortLength(r.id, [r.prev, r.next]),
    );
    out.set(r.id, { short_id: short, url: battleUrl(short) });
  }
  return out;
}

/** The recorded battles a reference names: a full id, a short id or a
 *  battle link. Returns at most `limit` full ids, in id order; an empty
 *  list when nothing matches or the reference is not a battle's. More
 *  than one means a short id two battles share (a link handed out before
 *  the second was recorded). */
export async function resolveBattleRef(db, ref, limit = 5) {
  const id = parseBattleRef(String(ref ?? ""));
  if (!id) return [];
  if (id.length === 64) {
    const { rows } = await db.query(
      `select battle_id from battle where battle_id = $1`,
      [id],
    );
    return rows.map((r) => r.battle_id);
  }
  const { rows } = await db.query(
    `select battle_id from battle
      where battle_id >= $1 and battle_id <= $2
      order by battle_id
      limit ${Math.max(1, Math.min(Number(limit) || 5, 20))}`,
    [id.padEnd(64, "0"), id.padEnd(64, "f")],
  );
  return rows.map((r) => r.battle_id);
}
