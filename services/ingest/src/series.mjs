/**
 * The daily series (time-series review, docs/reviews/2026-09-18-TIME-SERIES.md
 * Parts 3 and 4; Jamie's decisions of 2026-09-17 applied, not reopened).
 *
 * A pull feeds every subject it describes. The roster is a partial
 * profile read of up to fifty players made up to 96 times a day, and
 * until 2026-09-17 the projector kept four identity columns of it. Two
 * functions here are the series half of two projectors, called by the
 * live path (pipeline.mjs) and by the archive backfill ({series_backfill})
 * alike, with `observedAt` the receipt's fetched_at:
 *
 *   projectClanSeries    the clan row (clan_snapshot_daily) and the roster
 *                        columns of every member's own snapshot row
 *   projectPlayerProgress the profile's progress buckets
 *                        (player_progress_daily)
 *
 * The day is the game day (gameDay(), the 10:00Z grid). One row per
 * subject per day, the last observation wins under the observed_at
 * guard; a poll whose values did not move writes nothing; every upsert
 * is guarded on its own columns and its own timestamp; every function
 * returns facts (0077). The kinds: pre_reset (the hour before the Monday
 * 00:10Z donation reset) and season_roll (the hour before the season
 * rolls) are the same function called again with `kind`, inside the
 * window; the progress series has no weekly counter and gets
 * season_roll only.
 *
 * Two writers on the snapshot row, three stamps. The roster's own
 * columns are clan_tag, clan_rank, previous_clan_rank and
 * game_last_seen_at, dated by roster_observed_at (0133); the profile's
 * own are the lifetime block and the rest, dated by profile_observed_at
 * (snapshots.mjs); trophies, donations, donations_received and arena_id
 * are shared and belong to whichever observation is the row's newest
 * (observed_at, the greatest of either). Each writer guards on its own
 * columns and its own stamp, so neither can regress the other, a
 * roster older than the day's last profile poll still lands the clan
 * and rank, and a replayed old payload from either side writes nothing.
 */

import { gameDay, inPreResetWindow, normalizeTag } from "@elixir-mcp/contracts";
import { inSeasonRollWindow } from "./war-clock.mjs";
import { crTimeToIso } from "./battle-time.mjs";
import { ensureSeason, parseProgressKey } from "./season.mjs";
import {
  arenaChangedMoment,
  upsertProfileSnapshot,
  projectFrozenCounters,
  projectPolSeason,
} from "./snapshots.mjs";

const byTag = (a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
const int = (v) => (Number.isInteger(v) ? v : null);

/** Which extra kinds this observation falls inside, for a series that
 *  takes `weekly` (pre_reset) rows or not. */
function extraKinds(observedAt, { weekly }) {
  const at = Date.parse(observedAt);
  const kinds = [];
  if (weekly && inPreResetWindow(new Date(at))) kinds.push("pre_reset");
  if (inSeasonRollWindow(at)) kinds.push("season_roll");
  return kinds;
}

/**
 * The clan row and the members' roster columns from one admitted clan
 * payload. `source` is 'api' for a payload (live or archive) and
 * 'elixir-bot' for the Part 6 import, which comes through here too.
 */
export async function projectClanSeries(
  db,
  {
    payload,
    observedAt,
    receiptId = null,
    source = "api",
    kind = "daily",
    moments = true,
    // false when the day's clan row is the recorder's own and only the
    // members named in the payload are to be written (the elixir-bot
    // import's non-overlap rule, review 6.1).
    clanRow: writeClanRow = true,
  },
) {
  const clanTag = normalizeTag(payload.tag);
  const day = gameDay(observedAt);
  let facts = 0;

  // The rows this one references. The live roster projector has already
  // written both; the backfill and the import arrive here first. ON
  // CONFLICT DO NOTHING writes no tuple when the row exists.
  await db.query(
    `insert into clan (clan_tag, name) values ($1, $2) on conflict do nothing`,
    [clanTag, payload.name ?? null],
  );

  // The clan's own state, change-only (review 2.2): type, location,
  // description ride the clan row; type and location also ride the
  // series row by decision 5 so a day reads whole.
  const type = typeof payload.type === "string" ? payload.type : null;
  const locationId = int(payload.location?.id);
  const description =
    typeof payload.description === "string" ? payload.description : null;
  const { rowCount: clanState } = await db.query(
    `update clan set type = coalesce($2, type),
            location_id = coalesce($3, location_id),
            description = coalesce($4, description)
     where clan_tag = $1
       and (type is distinct from coalesce($2, type)
            or location_id is distinct from coalesce($3, location_id)
            or description is distinct from coalesce($4, description))`,
    [clanTag, type, locationId, description],
  );
  facts += clanState;

  let clanRow = 0;
  if (writeClanRow)
    ({ rowCount: clanRow } = await db.query(
      `insert into clan_snapshot_daily
       (clan_tag, day, snapshot_kind, observed_at, receipt_id, source,
        clan_score, clan_war_trophies, members, required_trophies, donations_per_week,
        type, location_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (clan_tag, day, snapshot_kind) do update set
       observed_at = excluded.observed_at, receipt_id = excluded.receipt_id,
       source = excluded.source,
       clan_score = excluded.clan_score, clan_war_trophies = excluded.clan_war_trophies,
       members = excluded.members, required_trophies = excluded.required_trophies,
       donations_per_week = excluded.donations_per_week,
       type = excluded.type, location_id = excluded.location_id
     where excluded.observed_at >= clan_snapshot_daily.observed_at
       and (clan_snapshot_daily.clan_score, clan_snapshot_daily.clan_war_trophies,
            clan_snapshot_daily.members, clan_snapshot_daily.required_trophies,
            clan_snapshot_daily.donations_per_week, clan_snapshot_daily.type,
            clan_snapshot_daily.location_id)
           is distinct from
           (excluded.clan_score, excluded.clan_war_trophies, excluded.members,
            excluded.required_trophies, excluded.donations_per_week, excluded.type,
            excluded.location_id)`,
      [
        clanTag,
        day,
        kind,
        observedAt,
        receiptId,
        source,
        int(payload.clanScore),
        int(payload.clanWarTrophies),
        int(payload.members) ?? payload.memberList?.length ?? null,
        int(payload.requiredTrophies),
        int(payload.donationsPerWeek),
        type,
        locationId,
      ],
    ));
  facts += clanRow;

  // The members' own rows: one unnest upsert in tag order (the lock
  // order every bulk upsert in this repo takes), guarded on the roster's
  // columns and observed_at only. A poll that moved ONLY
  // game_last_seen_at writes when the new value is an hour or more past
  // the stored one (the rule player.last_seen_at follows): the presence
  // series is kept to the hour inside a day, and an active clan's 96
  // polls do not rewrite fifty rows each.
  const members = (payload.memberList ?? [])
    .map((m) => ({
      tag: normalizeTag(m.tag),
      name: m.name ?? null,
      trophies: int(m.trophies),
      donations: int(m.donations),
      donationsReceived: int(m.donationsReceived),
      arenaId: int(m.arena?.id),
      clanRank: int(m.clanRank),
      previousClanRank: int(m.previousClanRank),
      gameLastSeen: m.lastSeen ? crTimeToIso(m.lastSeen) : null,
    }))
    .sort(byTag);
  // The arena catalog: the roster is a second source of arena names
  // (the profile was the only one before 2026-09-17).
  const arenaNames = new Map();
  for (const m of payload.memberList ?? [])
    if (int(m.arena?.id) && typeof m.arena?.name === "string")
      arenaNames.set(m.arena.id, m.arena.name);
  if (arenaNames.size > 0)
    await db.query(
      `insert into arena (arena_id, name, observed_at)
       select t.id, t.name, $3::timestamptz from unnest($1::int[], $2::text[]) as t(id, name)
       on conflict (arena_id) do update
         set name = excluded.name, observed_at = excluded.observed_at
       where arena.name is distinct from excluded.name`,
      [[...arenaNames.keys()], [...arenaNames.values()], observedAt],
    );

  let membersMoved = 0;
  let arenaMoments = 0;
  if (members.length > 0) {
    // The members' latest observation of either writer before this
    // poll: the arena baseline. A member whose arena moved gets the
    // arena_changed moment from here, at the roster's cadence, with the
    // crossing battle when the record holds it (snapshots.mjs); a
    // member with no prior row is first sight and gets nothing. Fresh
    // observations only, the pipeline's own rule for yield, burst and
    // the refresh request (within 24 hours of now): a replay writes
    // rows and never moments (the 09-15 roster replay skipped
    // projection for that reason), and the Part 5 backfill passes the
    // receipt id as the row's provenance, so the receipt is not the
    // gate.
    // `moments: false` is the backfill's: a replay writes rows and never
    // moments, and the freshness rule alone did not say so for the
    // last day's receipts (the clan lane on 2026-09-17 walked them and
    // wrote a moment per poll for every member who had moved that day,
    // because the prior observation it saw was yesterday's row).
    const priorArena = new Map();
    const fresh = Date.parse(observedAt) > Date.now() - 24 * 3600_000;
    if (moments && kind === "daily" && source === "api" && fresh) {
      const { rows: prior } = await db.query(
        `select distinct on (player_tag) player_tag, arena_id, observed_at
         from player_snapshot_daily
         where player_tag = any($1::text[]) and observed_at < $2::timestamptz
         order by player_tag, observed_at desc`,
        [members.map((m) => m.tag), observedAt],
      );
      for (const r of prior) priorArena.set(r.player_tag, r);
    }
    await db.query(
      `insert into player (player_tag, name)
       select t.tag, t.name from unnest($1::text[], $2::text[]) as t(tag, name)
       on conflict do nothing`,
      [members.map((m) => m.tag), members.map((m) => m.name)],
    );
    // Three stamps, one row. The roster's own four columns are dated by
    // roster_observed_at (0133) and guarded on it; the columns it shares
    // with the profile (trophies, donations, donations_received,
    // arena_id) take this observation only when it is the row's newest
    // (observed_at); observed_at is the greatest of either writer. So a
    // roster older than the day's last profile poll still lands the
    // clan and rank the profile never writes, and never regresses a
    // fresher trophy count.
    const { rowCount } = await db.query(
      `insert into player_snapshot_daily
         (player_tag, snapshot_date, snapshot_kind, observed_at, roster_observed_at, source,
          trophies, donations, donations_received, arena_id,
          clan_tag, clan_rank, previous_clan_rank, game_last_seen_at)
       select t.tag, $1::date, $2, $3::timestamptz, $3::timestamptz, $4,
              t.trophies, t.donations, t.received, t.arena,
              $5, t.rank, t.prev_rank, t.seen::timestamptz
       from unnest($6::text[], $7::int[], $8::int[], $9::int[], $10::int[],
                   $11::int[], $12::int[], $13::text[])
         as t(tag, trophies, donations, received, arena, rank, prev_rank, seen)
       on conflict (player_tag, snapshot_date, snapshot_kind) do update set
         observed_at = greatest(excluded.observed_at, player_snapshot_daily.observed_at),
         roster_observed_at = greatest(excluded.roster_observed_at, player_snapshot_daily.roster_observed_at),
         source = excluded.source,
         trophies = case when excluded.observed_at >= coalesce(player_snapshot_daily.observed_at, '-infinity')
                         then excluded.trophies else player_snapshot_daily.trophies end,
         donations = case when excluded.observed_at >= coalesce(player_snapshot_daily.observed_at, '-infinity')
                          then excluded.donations else player_snapshot_daily.donations end,
         donations_received = case when excluded.observed_at >= coalesce(player_snapshot_daily.observed_at, '-infinity')
                                   then excluded.donations_received else player_snapshot_daily.donations_received end,
         arena_id = case when excluded.observed_at >= coalesce(player_snapshot_daily.observed_at, '-infinity')
                         then excluded.arena_id else player_snapshot_daily.arena_id end,
         clan_tag = case when excluded.roster_observed_at >= coalesce(player_snapshot_daily.roster_observed_at, '-infinity')
                         then excluded.clan_tag else player_snapshot_daily.clan_tag end,
         clan_rank = case when excluded.roster_observed_at >= coalesce(player_snapshot_daily.roster_observed_at, '-infinity')
                          then excluded.clan_rank else player_snapshot_daily.clan_rank end,
         previous_clan_rank = case when excluded.roster_observed_at >= coalesce(player_snapshot_daily.roster_observed_at, '-infinity')
                                   then excluded.previous_clan_rank else player_snapshot_daily.previous_clan_rank end,
         game_last_seen_at = greatest(excluded.game_last_seen_at,
                                      player_snapshot_daily.game_last_seen_at)
       where (excluded.roster_observed_at >= coalesce(player_snapshot_daily.roster_observed_at, '-infinity')
              and ((player_snapshot_daily.clan_tag, player_snapshot_daily.clan_rank,
                    player_snapshot_daily.previous_clan_rank)
                   is distinct from (excluded.clan_tag, excluded.clan_rank, excluded.previous_clan_rank)
                or (excluded.game_last_seen_at is not null
                    and (player_snapshot_daily.game_last_seen_at is null
                         or excluded.game_last_seen_at
                            >= player_snapshot_daily.game_last_seen_at + interval '1 hour'))))
          or (excluded.observed_at >= coalesce(player_snapshot_daily.observed_at, '-infinity')
              and (player_snapshot_daily.trophies, player_snapshot_daily.donations,
                   player_snapshot_daily.donations_received, player_snapshot_daily.arena_id)
                  is distinct from
                  (excluded.trophies, excluded.donations, excluded.donations_received, excluded.arena_id))`,
      [
        day,
        kind,
        observedAt,
        source,
        clanTag,
        members.map((m) => m.tag),
        members.map((m) => m.trophies),
        members.map((m) => m.donations),
        members.map((m) => m.donationsReceived),
        members.map((m) => m.arenaId),
        members.map((m) => m.clanRank),
        members.map((m) => m.previousClanRank),
        members.map((m) => m.gameLastSeen),
      ],
    );
    membersMoved = rowCount;
    facts += rowCount;
    for (const m of members) {
      const prior = priorArena.get(m.tag);
      if (
        !prior ||
        prior.arena_id === null ||
        m.arenaId === null ||
        m.arenaId === prior.arena_id
      )
        continue;
      // Once per crossing, whichever writer or delivery sees it: a moment
      // into this arena already on the ledger since the prior observation
      // is the same move.
      const { rows: already } = await db.query(
        `select 1 from player_event
          where player_tag = $1 and event_type = 'arena_changed' and arena_to = $2
            and window_end >= $3::timestamptz limit 1`,
        [m.tag, m.arenaId, prior.observed_at],
      );
      if (already.length) continue;
      await arenaChangedMoment(db, {
        playerTag: m.tag,
        from: prior.arena_id,
        to: m.arenaId,
        toName: arenaNames.get(m.arenaId) ?? null,
        windowStart: prior.observed_at.toISOString(),
        windowEnd: observedAt,
        receiptId,
      });
      arenaMoments += 1;
    }
  }

  const extras = {};
  if (kind === "daily")
    for (const extra of extraKinds(observedAt, { weekly: true })) {
      extras[extra] = await projectClanSeries(db, {
        payload,
        observedAt,
        receiptId,
        source,
        kind: extra,
        moments,
        clanRow: writeClanRow,
      });
      facts += extras[extra].facts;
    }

  return {
    day,
    kind,
    clanRow,
    membersMoved,
    arenaMoments,
    members: members.length,
    ...(Object.keys(extras).length ? { extras } : {}),
    facts,
  };
}

/**
 * The profile's progress buckets (review 4.3). Every key becomes a
 * mode_season row (the "" key included since 2026-09-17: it is the
 * Merge Tactics pre-season arena, cr-agent-api-docs 8339a89) and every
 * bucket with any value becomes a day row; a bucket reading trophies 0
 * and bestTrophies 0 writes no row (Jamie: "no record for no activity").
 */
export async function projectPlayerProgress(
  db,
  { playerTag, payload, observedAt, kind = "daily" },
) {
  const progress = payload?.progress;
  if (!progress || typeof progress !== "object")
    return { keys: 0, rows: 0, facts: 0 };
  const day = gameDay(observedAt);
  const buckets = [];
  for (const [rawKey, bucket] of Object.entries(progress)) {
    const key = parseProgressKey(rawKey);
    if (!key || !bucket || typeof bucket !== "object") continue;
    const trophies = int(bucket.trophies);
    const best = int(bucket.bestTrophies);
    if ((trophies ?? 0) === 0 && (best ?? 0) === 0) continue;
    buckets.push({
      tag: key.progress_key,
      trophies,
      best,
      arenaId: int(bucket.arena?.id),
    });
  }
  buckets.sort(byTag);
  let rows = 0;
  if (buckets.length > 0) {
    // The keys exist on mode_season (projectModeSeasons wrote them in
    // the same transaction on the live path; the backfill lands here
    // first), and any month a key names has its season row.
    for (const b of buckets) {
      const k = parseProgressKey(b.tag);
      if (k.season_month) await ensureSeason(db, k.season_month);
    }
    await db.query(
      `insert into mode_season (progress_key, mode, season_month, first_seen_at, last_seen_at)
       select t.key, t.mode, t.month, $4::timestamptz, $4::timestamptz
       from unnest($1::text[], $2::text[], $3::text[]) as t(key, mode, month)
       on conflict do nothing`,
      [
        buckets.map((b) => b.tag),
        buckets.map((b) => parseProgressKey(b.tag).mode),
        buckets.map((b) => parseProgressKey(b.tag).season_month),
        observedAt,
      ],
    );
    // The side-mode arenas (168000xxx) are named only here: the catalog
    // takes them the way it takes the roster's (verification item 4).
    const arenas = new Map();
    for (const bucket of Object.values(progress))
      if (int(bucket?.arena?.id) && typeof bucket.arena?.name === "string")
        arenas.set(bucket.arena.id, bucket.arena.name);
    if (arenas.size > 0)
      await db.query(
        `insert into arena (arena_id, name, observed_at)
         select t.id, t.name, $3::timestamptz from unnest($1::int[], $2::text[]) as t(id, name)
         on conflict (arena_id) do update
           set name = excluded.name, observed_at = excluded.observed_at
         where arena.name is distinct from excluded.name`,
        [[...arenas.keys()], [...arenas.values()], observedAt],
      );
    const { rowCount } = await db.query(
      `insert into player_progress_daily
         (player_tag, progress_key, day, snapshot_kind, observed_at, trophies, best_trophies, arena_id)
       select $1, t.key, $2::date, $3, $4::timestamptz, t.trophies, t.best, t.arena
       from unnest($5::text[], $6::int[], $7::int[], $8::int[]) as t(key, trophies, best, arena)
       on conflict (player_tag, progress_key, day, snapshot_kind) do update set
         observed_at = excluded.observed_at, trophies = excluded.trophies,
         best_trophies = excluded.best_trophies, arena_id = excluded.arena_id
       where excluded.observed_at >= player_progress_daily.observed_at
         and (player_progress_daily.trophies, player_progress_daily.best_trophies,
              player_progress_daily.arena_id)
             is distinct from (excluded.trophies, excluded.best_trophies, excluded.arena_id)`,
      [
        playerTag,
        day,
        kind,
        observedAt,
        buckets.map((b) => b.tag),
        buckets.map((b) => b.trophies),
        buckets.map((b) => b.best),
        buckets.map((b) => b.arenaId),
      ],
    );
    rows = rowCount;
  }
  let facts = rows;
  if (kind === "daily")
    for (const extra of extraKinds(observedAt, { weekly: false })) {
      const r = await projectPlayerProgress(db, {
        playerTag,
        payload,
        observedAt,
        kind: extra,
      });
      facts += r.facts;
    }
  return { day, kind, keys: buckets.length, rows, facts };
}

/**
 * The series half of the profile projector, for the backfill (review
 * Part 5): the snapshot row and its kinds, the progress buckets, the
 * frozen counters, the previous season's final. No baselines, no
 * moments, no badges, no collection (those the live poll wrote at the
 * time). The snapshot upsert's guard on profile_observed_at is what
 * makes a day's LAST receipt win and every earlier one write nothing
 * against an existing row. Returns facts.
 */
export async function projectProfileSeries(
  db,
  { playerTag, payload, observedAt },
) {
  let facts = await upsertProfileSnapshot(db, {
    playerTag,
    payload,
    fetchedAt: observedAt,
  });
  for (const kind of extraKinds(observedAt, { weekly: true }))
    facts += await upsertProfileSnapshot(db, {
      playerTag,
      payload,
      fetchedAt: observedAt,
      kind,
    });
  const progress = await projectPlayerProgress(db, {
    playerTag,
    payload,
    observedAt,
  });
  facts += progress.facts;
  facts += await projectFrozenCounters(db, { playerTag, payload });
  facts += await projectPolSeason(db, {
    playerTag,
    payload,
    fetchedAt: observedAt,
  });
  return { day: gameDay(observedAt), facts };
}
