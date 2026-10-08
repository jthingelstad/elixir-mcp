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

/** The game's four roles in rank order; a change is one of two directions. */
const ROLE_RANK = { member: 0, elder: 1, coLeader: 2, leader: 3 };
function roleDirection(prevRole, newRole) {
  const a = ROLE_RANK[prevRole] ?? -1;
  const b = ROLE_RANK[newRole] ?? -1;
  if (a < 0 || b < 0 || a === b) return "unknown";
  return b > a ? "promoted" : "demoted";
}

/**
 * Who a roster poll records (Jamie, 2026-10-06). A clan someone tracks
 * records every member. Any other clan is read only because a tracked
 * player is in it, so it records just the tracked players on its roster:
 * the rest of that clan is not Elixir's to keep. Returns null for "all",
 * else the set of tags to record.
 */
export async function rosterRecords(db, clanTag, tags) {
  const {
    rows: [r],
  } = await db.query(
    `select (exists (select 1 from recording
                      where subject_type = 'clan' and status = 'active'
                        and subject_tag = $1)
             or exists (select 1 from account_clan where clan_tag = $1))
              as tracked,
            array(select t.tag from unnest($2::text[]) as t(tag)
                   where exists (select 1 from recording r
                                  where r.subject_type = 'player'
                                    and r.status = 'active'
                                    and r.subject_tag = t.tag)
                      or exists (select 1 from claim c
                                  where c.player_tag = t.tag)) as recorded`,
    [clanTag, tags],
  );
  return r.tracked ? null : new Set(r.recorded);
}

/**
 * Which of `tags` the clan's previous read recorded too, so that their
 * absence from it was observed (0207). A clan that recorded every member
 * last time saw everyone; one read only for its tracked players saw just
 * the players tracked since before that read. Returns null for "all".
 */
async function seenBefore(db, { prevAll, windowStart, tags }) {
  if (prevAll) return null;
  if (!windowStart || tags.length === 0) return new Set();
  const { rows } = await db.query(
    `select t.tag from unnest($1::text[]) as t(tag)
      where exists (select 1 from recording r
                     where r.subject_type = 'player' and r.status = 'active'
                       and r.subject_tag = t.tag and r.created_at <= $2)
         or exists (select 1 from claim c
                     where c.player_tag = t.tag and c.created_at <= $2)`,
    [tags, windowStart],
  );
  return new Set(rows.map((r) => r.tag));
}

/**
 * Ingest one admitted clan payload. Caller owns the transaction.
 * windowStart (the previous admitted observation) brackets the emitted
 * events honestly.
 *
 * A first sight is a BASELINE, never a join (elixir-bot invariant: the
 * seed observation is silent, there is no diff yet; 0207 for the rest):
 * the clan's first read, and any member the previous read did not record
 * (a clan read only for its tracked players that becomes tracked, a player
 * tracked since that read). Their row opens with `baseline` set, so
 * neither the clan's events nor the player's timeline narrate a join, and
 * a role seen for the first time is not a change.
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

  // Liveliness and departures read the whole roster; writes go only to
  // the members this clan records.
  const only = await rosterRecords(
    db,
    clanTag,
    members.map((m) => m.tag),
  );
  const recorded = only ? members.filter((m) => only.has(m.tag)) : members;

  // One statement for the whole roster, tag-ordered (lock order), and
  // guarded: only when something moves. A roster is polled far more
  // often than a member plays, and an unchanged row rewritten is a dead
  // tuple for nothing - and fifty round trips a poll besides.
  const ordered = [...recorded].sort((a, b) =>
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
  // Did the previous read record every member? Null before 0207: assume
  // it recorded what this one does, as the rule was then.
  const {
    rows: [scope],
  } = await db.query(
    `select roster_recorded_all from clan where clan_tag = $1`,
    [clanTag],
  );
  const recordsAll = only === null;
  const prevAll = scope?.roster_recorded_all ?? recordsAll;
  const seen = firstSight
    ? new Set()
    : await seenBefore(db, {
        prevAll,
        windowStart,
        tags: recorded
          .filter((m) => {
            const o = openByTag.get(m.tag);
            return !o || o.role !== m.role;
          })
          .map((m) => m.tag),
      });
  /** The previous read could have seen this member: a change is news. */
  const observed = (tag) => !firstSight && (seen === null || seen.has(tag));
  if (scope && scope.roster_recorded_all !== recordsAll)
    await db.query(
      `update clan set roster_recorded_all = $2 where clan_tag = $1`,
      [clanTag, recordsAll],
    );
  const evidence = (extra) => ({
    roster_size_before: open.length,
    roster_size_after: members.length,
    ...extra,
  });
  const emit = async (type, payload) => {
    await emitEvent(db, type, {
      tag: clanTag,
      payload,
      windowStart: windowStart ?? at,
      windowEnd: at,
      receiptId: receiptId ?? null,
    });
  };

  let joined = 0;
  let baselined = 0;
  let departed = 0;
  let roleChanged = 0;

  for (const m of recorded) {
    const existing = openByTag.get(m.tag);
    if (!existing) {
      // A player can hold at most one open membership anywhere (partial
      // unique index): close a stale open membership in another clan first.
      await db.query(
        `update clan_membership set left_observed_at = $2
         where player_tag = $1 and left_observed_at is null and clan_tag <> $3`,
        [m.tag, at, clanTag],
      );
      const join = observed(m.tag);
      await db.query(
        `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role, baseline)
         values ($1, $2, $3, $4, $5)`,
        [clanTag, m.tag, at, m.role, !join],
      );
      if (!join) {
        baselined += 1;
        continue;
      }
      await emit(
        "member_joined",
        evidence({ player_tag: m.tag, name: m.name, role: m.role }),
      );
      joined += 1;
    } else if (existing.role !== m.role) {
      await db.query(
        `update clan_membership set role = $3
         where clan_tag = $1 and player_tag = $2 and left_observed_at is null`,
        [clanTag, m.tag, m.role],
      );
      // A role first recorded now (the member was not recorded before)
      // changed at some unknown time: the row moves, no moment.
      if (!observed(m.tag)) continue;
      await emit(
        "role_changed",
        evidence({
          player_tag: m.tag,
          name: m.name,
          role_before: existing.role,
          role_after: m.role,
          direction: roleDirection(existing.role, m.role),
        }),
      );
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
      // Stamp the last-known name at the source: the tag alone forces
      // every reader to reconstruct who left (casual pass, 2026-09-06).
      const { rows: leftName } = await db.query(
        `select name from player where player_tag = $1`,
        [r.player_tag],
      );
      // A departure needs no baseline: the open row is the earlier
      // observation it is diffed against.
      await emit(
        "member_left",
        evidence({
          player_tag: r.player_tag,
          name: leftName[0]?.name ?? null,
          role_at_departure: r.role,
          joined_observed_at: r.joined_observed_at,
        }),
      );
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
    // Memberships opened on a baseline read: first sightings, not joins.
    baselined,
    departed,
    roleChanged,
    // What this poll added to the record (0077): membership events and
    // member rows that moved (a name, a lastSeen, an hour-stale sighting).
    facts: joined + baselined + departed + roleChanged + playersChanged,
    activeNow: seenWithin(3600_000),
    seen24h: seenWithin(86_400_000),
  };
}
