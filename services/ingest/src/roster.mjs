/**
 * Clan roster ingest — DESIGN §4.1/§4.2.
 *
 * The 15-minute clan heartbeat payload seeds/refreshes player rows for
 * every member for free (clan auto-follow) and maintains OBSERVED
 * membership tenure: open rows for members present, closed rows when they
 * disappear. Tenure is observed, never asserted — the DB's open rows are
 * the baseline that roster diffs run against.
 */

import { normalizeTag } from "@elixir-mcp/contracts";
import { emitEvent } from "./events.mjs";
import { crTimeToIso } from "./battle-time.mjs";

/**
 * Ingest one admitted clan payload. Caller owns the transaction.
 * windowStart (the previous admitted observation) brackets the emitted
 * events honestly; first sight of a clan emits NO events (elixir-bot
 * invariant: the seed observation is silent — there is no diff yet).
 */
export async function ingestClanRoster(
  db,
  { payload, observedAt, windowStart, receiptId },
) {
  const clanTag = normalizeTag(payload.tag);
  const at = observedAt ?? new Date().toISOString();

  // The clan row: a rename or a badge is news; last_seen_at moves at
  // most hourly, like a player's, so a quiet clan polled all day is
  // not rewritten all day (21,377 updates on 5,151 rows before 2026-09-11).
  await db.query(
    `insert into clan (clan_tag, name, badge_id, last_seen_at) values ($1, $2, $3, $4)
     on conflict (clan_tag) do update
       set name = excluded.name,
           badge_id = coalesce(excluded.badge_id, clan.badge_id),
           last_seen_at = greatest(excluded.last_seen_at, clan.last_seen_at)
     where clan.name is distinct from excluded.name
        or (excluded.badge_id is not null and clan.badge_id is distinct from excluded.badge_id)
        or clan.last_seen_at is null
        or clan.last_seen_at < excluded.last_seen_at - interval '1 hour'`,
    [clanTag, payload.name, payload.badgeId ?? null, at],
  );

  const members = payload.memberList.map((m) => ({
    tag: normalizeTag(m.tag),
    name: m.name ?? null,
    role: m.role ?? null,
    // The game's own activity stamp, which exists ONLY here - /players/{tag}
    // does not carry it - so a poll that drops it loses that moment for good.
    // Lenient on purpose: a strange lastSeen must not stop a roster run.
    gameLastSeen: crTimeToIso(m.lastSeen),
  }));

  // One statement for the whole roster, tag-ordered (lock order), and
  // guarded: only when something moves. A roster is polled far more
  // often than a member plays, and an unchanged row rewritten is a dead
  // tuple for nothing - and fifty round trips a poll besides.
  const ordered = [...members].sort((a, b) =>
    a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0,
  );
  const { rowCount: playersChanged } = await db.query(
    `insert into player (player_tag, name, last_seen_at, game_last_seen_at)
     select t.tag, t.name, $3::timestamptz, t.seen::timestamptz
     from unnest($1::text[], $2::text[], $4::text[]) as t(tag, name, seen)
     on conflict (player_tag) do update
       set name = coalesce(excluded.name, player.name),
           last_seen_at = excluded.last_seen_at,
           -- Never move BACKWARDS. Rosters are polled per clan and an older
           -- payload can be admitted after a newer one; greatest() with a
           -- null-safe fallback keeps the freshest sighting either way.
           game_last_seen_at = greatest(
             excluded.game_last_seen_at,
             player.game_last_seen_at)
     where player.name is distinct from coalesce(excluded.name, player.name)
        or player.game_last_seen_at is distinct from
           greatest(excluded.game_last_seen_at, player.game_last_seen_at)
        or player.last_seen_at < excluded.last_seen_at - interval '1 day'`,
    [
      ordered.map((m) => m.tag),
      ordered.map((m) => m.name),
      at,
      ordered.map((m) => m.gameLastSeen),
    ],
  );

  const { rows: open } = await db.query(
    `select player_tag, joined_observed_at, role from clan_membership
     where clan_tag = $1 and left_observed_at is null`,
    [clanTag],
  );
  const openByTag = new Map(open.map((r) => [r.player_tag, r]));
  const rosterTags = new Set(members.map((m) => m.tag));
  const firstSight = open.length === 0;
  const evidence = (extra) => ({
    roster_size_before: open.length,
    roster_size_after: members.length,
    ...extra,
  });
  const emit = async (type, payload) => {
    if (firstSight) return;
    await emitEvent(db, type, {
      tag: clanTag,
      payload,
      windowStart: windowStart ?? at,
      windowEnd: at,
      receiptId: receiptId ?? null,
    });
  };

  let joined = 0;
  let departed = 0;
  let roleChanged = 0;
  // Push lane (Jamie, 2026-09-06: "clan notifications aren't working" -
  // the only clan topic was the WEEKLY war boundary): roster changes
  // are the clan happenings people mean. Collected here, emitted by
  // the pipeline AFTER commit; firstSight stays silent like emit().
  const feedEvents = [];
  const feed = (topic, payload) => {
    if (firstSight) return;
    feedEvents.push({ kind: "clan", tag: clanTag, topic, payload });
  };

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
      await emit(
        "member_joined",
        evidence({ player_tag: m.tag, name: m.name, role: m.role }),
      );
      feed("member_joined", { player_tag: m.tag, name: m.name });
      joined += 1;
    } else if (existing.role !== m.role) {
      await db.query(
        `update clan_membership set role = $3
         where clan_tag = $1 and player_tag = $2 and left_observed_at is null`,
        [clanTag, m.tag, m.role],
      );
      await emit(
        "role_changed",
        evidence({
          player_tag: m.tag,
          name: m.name,
          role_before: existing.role,
          role_after: m.role,
        }),
      );
      feed("member_role_changed", {
        player_tag: m.tag,
        name: m.name,
        role: m.role,
      });
      roleChanged += 1;
    }
  }

  for (const r of open) {
    if (!rosterTags.has(r.player_tag)) {
      await db.query(
        `update clan_membership set left_observed_at = $3
         where clan_tag = $1 and player_tag = $2 and left_observed_at is null`,
        [clanTag, r.player_tag, at],
      );
      await emit(
        "member_left",
        evidence({
          player_tag: r.player_tag,
          role_at_departure: r.role,
          joined_observed_at: r.joined_observed_at,
        }),
      );
      // Stamp the last-known name at the source: the tag alone forces
      // every reader to reconstruct who left (casual pass, 2026-09-06).
      const { rows: leftName } = await db.query(
        `select name from player where player_tag = $1`,
        [r.player_tag],
      );
      feed("member_left", {
        player_tag: r.player_tag,
        name: leftName[0]?.name ?? null,
      });
      departed += 1;
    }
  }

  // Liveliness, from the game's own lastSeen stamps (2026-09-11): how
  // many members were in the game within the last hour of this
  // observation, and within the last day. The clan cadence reads it -
  // a clan with nobody online cannot be joining, leaving or promoting.
  const atMs = Date.parse(at);
  const seenWithin = (ms) =>
    members.filter(
      (m) => m.gameLastSeen && atMs - Date.parse(m.gameLastSeen) <= ms,
    ).length;
  return {
    members: members.length,
    joined,
    departed,
    roleChanged,
    // What this poll added to the record (0077): membership events and
    // member rows that moved (a name, a lastSeen, an hour-stale sighting).
    facts: joined + departed + roleChanged + playersChanged,
    activeNow: seenWithin(3600_000),
    seen24h: seenWithin(86_400_000),
    feedEvents,
  };
}
