/**
 * Clan roster ingest — DESIGN §4.1/§4.2.
 *
 * The 15-minute clan heartbeat payload seeds/refreshes player rows for
 * every member for free (clan auto-follow) and maintains OBSERVED
 * membership tenure: open rows for members present, closed rows when they
 * disappear. Tenure is observed, never asserted — the DB's open rows are
 * the baseline that roster diffs run against.
 */

import { normalizeTag } from '@elixir-mcp/contracts';

/** Ingest one admitted clan payload. Caller owns the transaction. */
export async function ingestClanRoster(db, { payload, observedAt }) {
  const clanTag = normalizeTag(payload.tag);
  const at = observedAt ?? new Date().toISOString();

  await db.query(
    `insert into clan (clan_tag, name, last_seen_at) values ($1, $2, $3)
     on conflict (clan_tag) do update set name = excluded.name, last_seen_at = excluded.last_seen_at`,
    [clanTag, payload.name, at],
  );

  const members = payload.memberList.map((m) => ({
    tag: normalizeTag(m.tag),
    name: m.name ?? null,
    role: m.role ?? null,
  }));

  for (const m of members) {
    await db.query(
      `insert into player (player_tag, name, last_seen_at) values ($1, $2, $3)
       on conflict (player_tag) do update
         set name = coalesce(excluded.name, player.name), last_seen_at = excluded.last_seen_at`,
      [m.tag, m.name, at],
    );
  }

  const { rows: open } = await db.query(
    `select player_tag, joined_observed_at, role from clan_membership
     where clan_tag = $1 and left_observed_at is null`,
    [clanTag],
  );
  const openByTag = new Map(open.map((r) => [r.player_tag, r]));
  const rosterTags = new Set(members.map((m) => m.tag));

  let joined = 0;
  let departed = 0;

  for (const m of members) {
    const existing = openByTag.get(m.tag);
    if (!existing) {
      // A player can hold at most one open membership anywhere (partial
      // unique index): close a stale open membership in another clan first.
      await db.query(
        `update clan_membership set left_observed_at = $2
         where player_tag = $1 and left_observed_at is null and clan_tag <> $3`,
        [m.tag, at, clanTag],
      );
      await db.query(
        `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
         values ($1, $2, $3, $4)`,
        [clanTag, m.tag, at, m.role],
      );
      joined += 1;
    } else if (existing.role !== m.role) {
      await db.query(
        `update clan_membership set role = $3
         where clan_tag = $1 and player_tag = $2 and left_observed_at is null`,
        [clanTag, m.tag, m.role],
      );
    }
  }

  for (const r of open) {
    if (!rosterTags.has(r.player_tag)) {
      await db.query(
        `update clan_membership set left_observed_at = $3
         where clan_tag = $1 and player_tag = $2 and left_observed_at is null`,
        [clanTag, r.player_tag, at],
      );
      departed += 1;
    }
  }

  return { members: members.length, joined, departed };
}
