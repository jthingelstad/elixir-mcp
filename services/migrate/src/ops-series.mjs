/**
 * The daily series ops (time-series review, docs/reviews/2026-09-18-TIME-SERIES.md):
 * the archive backfill that fills the series tables from recorded
 * receipts, its status and self census, and the EXPLAIN of the shapes
 * the series tools serve. Each op documents itself below.
 */

import pg from "pg";

/**
 * {series_status: {hours?: 1}} - read-only: the series tables' row
 * counts and day spans, the snapshot table split by writer (roster-only,
 * profile-only, both), and what the last N hours of admitted clan and
 * player receipts were worth (new_facts) now that a roster poll counts
 * the members that moved. The Phase 1 NOTES numbers and Phase 2's
 * before/after.
 */
export async function seriesStatus(databaseUrl, spec = {}) {
  const hours = Math.min(Math.max(Number(spec.hours ?? 1), 1), 168);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set transaction_read_only = on");
    const {
      rows: [tables],
    } = await db.query(
      `select
         (select json_build_object('rows', count(*), 'clans', count(distinct clan_tag),
                 'first_day', min(day)::text, 'last_day', max(day)::text,
                 'kinds', (select json_object_agg(snapshot_kind, n) from
                           (select snapshot_kind, count(*)::int n from clan_snapshot_daily group by 1) k))
          from clan_snapshot_daily) as clan_snapshot_daily,
         (select json_build_object('rows', count(*), 'players', count(distinct player_tag),
                 'keys', count(distinct progress_key), 'first_day', min(day)::text, 'last_day', max(day)::text)
          from player_progress_daily) as player_progress_daily,
         (select json_build_object('rows', count(*), 'players', count(distinct player_tag),
                 'seasons', (select json_object_agg(season_month, n) from
                             (select season_month, count(*)::int n from player_pol_season group by 1) k))
          from player_pol_season) as player_pol_season,
         (select json_build_object('rows', count(*), 'clans', count(distinct clan_tag),
                 'sections', count(distinct (season_id, section_index)),
                 -- by war day (period_index % 7 - 2): day 4 was never kept
                 -- before 2026-09-18 (the projector's section scope rule).
                 'by_war_day', (select json_object_agg(d, n) from
                                (select period_index % 7 - 2 as d, count(*)::int as n
                                   from war_period_log group by 1 order by 1) w))
          from war_period_log) as war_period_log,
         (select json_build_object('rows', count(*),
                 'roster_only', count(*) filter (where roster_observed_at is not null and profile_observed_at is null),
                 'profile_only', count(*) filter (where roster_observed_at is null and profile_observed_at is not null),
                 'both', count(*) filter (where roster_observed_at is not null and profile_observed_at is not null),
                 'players', count(distinct player_tag),
                 'clans', count(distinct clan_tag),
                 'first_day', min(snapshot_date)::text, 'last_day', max(snapshot_date)::text,
                 'today_rows', count(*) filter (where snapshot_date = game_day(now())),
                 'today_roster_written', count(*) filter (where snapshot_date = game_day(now()) and roster_observed_at is not null))
          from player_snapshot_daily) as player_snapshot_daily,
         (select json_build_object('war_week_clan_with_score', count(*) filter (where clan_score is not null),
                 'war_week_clan_rows', count(*)) from war_week_clan) as war_week_clan,
         (select json_build_object('with_repairs', count(*) filter (where repair_points is not null),
                 'rows', count(*)) from war_participation) as war_participation,
         (select json_build_object('type', count(type), 'location', count(location_id), 'rows', count(*)) from clan) as clan_state,
         (select json_build_object('frozen', count(war_day_wins), 'rows', count(*)) from player) as player_state,
         (select json_build_object('keys', count(*), 'empty_key', count(*) filter (where progress_key = '')) from mode_season) as mode_season`,
    );
    const { rows: receipts } = await db.query(
      `select endpoint, count(*)::int as receipts,
              count(*) filter (where new_facts > 0)::int as with_facts,
              coalesce(sum(new_facts), 0)::int as facts,
              max(new_facts)::int as max_facts,
              round(avg(new_facts), 2)::float as avg_facts,
              round(avg(ingest_ms))::int as avg_ingest_ms,
              max(ingest_ms)::int as max_ingest_ms
       from api_receipt
       where admission = 'admitted' and fetched_at >= now() - make_interval(hours => $1)
         and endpoint in ('clan', 'player', 'currentriverrace', 'riverracelog')
       group by endpoint order by endpoint`,
      [hours],
    );
    // The arena moments of the last day and how many carry their
    // battle (Phase 2 correction 2: the log pins a roster-written one).
    const {
      rows: [arena],
    } = await db.query(
      `select count(*)::int as rows,
              count(battle_id)::int as with_battle,
              count(*) filter (where timing = 'exact')::int as exact,
              count(*) filter (where receipt_id in
                (select receipt_id from api_receipt where endpoint = 'clan'))::int as from_roster
       from player_event
       where event_type = 'arena_changed' and window_end > now() - interval '1 day'`,
    );
    return { hours, ...tables, arena_moments_24h: arena, receipts };
  } finally {
    await db.end();
  }
}

/**
 * {series_backfill: {lane: 'clan'|'player'|'race'|'battle', budget_s?: 45, batch?: 200}}
 *
 * The backfill from the archive (time-series review Part 5). Receipts,
 * not objects, are the walk: an archived object exists once per
 * distinct content, the receipts are one per admitted fetch, and
 * walking them in receipt_id order reproduces what the live projector
 * would have done. Per batch, in one short transaction: the next
 * `batch` admitted receipts of the lane's endpoint after the cursor,
 * each one's archived object (the key resolved from one ListObjectsV2
 * per entity on first sight, cached for the container's life; the
 * parsed payload cached by hash for the run), and the projector's
 * SERIES half only with observedAt = the receipt's fetched_at:
 * projectClanSeries (clan row + members' roster columns),
 * projectProfileSeries (the snapshot's profile columns and kinds, the
 * progress buckets, the frozen counters, the PoL final),
 * projectRaceSeries (the rivals' columns and the period logs, the
 * season from the calendar), and the battle lane's fill of the ten
 * battle columns (0131) from each log's entries. Never the membership
 * machine, never events, never anchors, never poll_state. The guards
 * make the order irrelevant to the result; the receipt order makes it
 * monotone anyway. Commit per batch, advance the cursor
 * (series_backfill_state), stop when the budget is spent or the lane
 * is done. Rerunnable; a local loop (infra/scripts/series-backfill.mjs)
 * drives it to completion with the migrate Lambda held.
 */
const LANE_ENDPOINT = {
  clan: "clan",
  player: "player",
  race: "currentriverrace",
  battle: "player_battlelog",
};
// endpoint/entity -> Map(hash16 -> key); lives as long as the container.
const keyMaps = new Map();

async function objectKeysFor(s3, bucket, endpoint, entityKey) {
  const id = `${endpoint}/${entityKey}`;
  if (keyMaps.has(id)) return keyMaps.get(id);
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const prefix = `payloads/endpoint=${endpoint}/entity=${entityKey.replace(/^#/, "")}/`;
  const map = new Map();
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const o of page.Contents ?? []) {
      const m = /-([0-9a-f]{16})\.json\.gz$/.exec(o.Key);
      if (m && !map.has(m[1])) map.set(m[1], o.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  keyMaps.set(id, map);
  return map;
}

/** The archive's two reads (`getObject(key)` -> gzip bytes, `listKeys(endpoint,
 *  entity)` -> Map(hash16 -> key)), from the test's in-memory archive or
 *  the bucket. */
async function archiveReads(deps = {}) {
  let getObject = deps.getObject;
  let listKeys = deps.listKeys;
  if (!getObject || !listKeys) {
    const bucket = process.env.ARCHIVE_BUCKET;
    if (!bucket) throw new Error("ARCHIVE_BUCKET not configured");
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({});
    getObject ??= async (key) => {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return Buffer.from(await res.Body.transformToByteArray());
    };
    listKeys ??= (ep, entity) => objectKeysFor(s3, bucket, ep, entity);
  }
  return { getObject, listKeys };
}

export async function seriesBackfill(databaseUrl, spec = {}, deps = {}) {
  const lane = String(spec.lane ?? "");
  const endpoint = LANE_ENDPOINT[lane];
  if (!endpoint)
    throw new Error(
      `series_backfill: lane must be one of ${Object.keys(LANE_ENDPOINT).join(", ")}`,
    );
  // 45 s by default, under the migrate-duration alarm's 90 s: a longer
  // default tripped the alarm by design (2026-09-25). A driver that
  // wants longer invocations passes budget_s, up to 280.
  const budgetMs =
    Math.min(Math.max(Number(spec.budget_s ?? 45), 5), 280) * 1000;
  // Fifty receipts a transaction, not two hundred: the first live run
  // (2026-09-17 21:4xZ) deadlocked against a collector submission on
  // the player rows both upsert, and a batch that holds fifty clans'
  // members for a second overlaps live ingest far less than one that
  // holds two hundred for twelve. A deadlock is the batch's to retry.
  const batch = Math.min(Math.max(Number(spec.batch ?? 50), 1), 2000);
  const { getObject, listKeys } = await archiveReads(deps);
  const { projectClanSeries, projectProfileSeries } =
    await import("../../ingest/src/series.mjs");
  const { projectRaceSeries, raceSeasonFor } =
    await import("../../ingest/src/war.mjs");
  const { canonicalizeBattle } = await import("../../ingest/src/battles.mjs");
  const { gunzipSync } = await import("node:zlib");

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  const tally = {
    lane,
    batches: 0,
    receipts: 0,
    rows_written: 0,
    objects_read: 0,
    cache_hits: 0,
    missing_objects: 0,
    unreadable: 0,
    unresolved_season: 0,
    deadlock_retries: 0,
    done: false,
  };
  const parsed = new Map(); // hash -> payload, this run
  try {
    await db.query(
      `insert into series_backfill_state (lane, started_at) values ($1, now())
       on conflict (lane) do update set started_at = coalesce(series_backfill_state.started_at, now())`,
      [lane],
    );
    // {reset: true}: walk the lane again from the first receipt (the
    // race lane after the slot-band repair, 2026-09-18). The guards make
    // a second walk exact; the tallies start over.
    if (spec.reset === true)
      await db.query(
        `update series_backfill_state
            set after_receipt_id = 0, receipts_done = 0, rows_written = 0,
                started_at = now(), finished_at = null, updated_at = now()
          where lane = $1`,
        [lane],
      );
    while (Date.now() - started < budgetMs) {
      const {
        rows: [state],
      } = await db.query(
        `select after_receipt_id, finished_at from series_backfill_state where lane = $1`,
        [lane],
      );
      const { rows: receipts } = await db.query(
        `select receipt_id, entity_key, fetched_at, payload_hash
         from api_receipt
         where endpoint = $1 and admission = 'admitted' and receipt_id > $2
         order by receipt_id limit $3`,
        [endpoint, state.after_receipt_id, batch],
      );
      if (receipts.length === 0) {
        await db.query(
          `update series_backfill_state set finished_at = coalesce(finished_at, now()), updated_at = now()
           where lane = $1`,
          [lane],
        );
        tally.done = true;
        break;
      }
      // The batch's objects first, concurrently (S3 is not the
      // database: a serial GET per receipt was most of the clan lane's
      // 57 ms a receipt on 2026-09-17), eight in flight, before the
      // transaction opens.
      const wanted = [];
      const fresh = new Set();
      for (const r of receipts) {
        if (parsed.has(r.payload_hash) || fresh.has(r.payload_hash)) continue;
        fresh.add(r.payload_hash);
        wanted.push(r);
      }
      for (let i = 0; i < wanted.length; i += 8) {
        await Promise.all(
          wanted.slice(i, i + 8).map(async (r) => {
            const keys = await listKeys(endpoint, r.entity_key);
            const key = keys.get(r.payload_hash.slice(0, 16));
            if (!key) {
              parsed.set(r.payload_hash, null);
              return;
            }
            try {
              parsed.set(
                r.payload_hash,
                JSON.parse(gunzipSync(await getObject(key)).toString("utf8")),
              );
              tally.objects_read += 1;
            } catch {
              tally.unreadable += 1;
              parsed.set(r.payload_hash, null);
            }
          }),
        );
      }
      let attempt = 0;
      for (;;) {
        await db.query("begin");
        try {
          let rows = 0;
          for (const r of receipts) {
            const payload = parsed.get(r.payload_hash);
            if (payload === null || payload === undefined) {
              if (attempt === 0) tally.missing_objects += 1;
              continue;
            }
            if (attempt === 0 && !fresh.has(r.payload_hash))
              tally.cache_hits += 1;
            const observedAt = r.fetched_at.toISOString();
            if (lane === "clan") {
              const out = await projectClanSeries(db, {
                payload,
                observedAt,
                receiptId: r.receipt_id,
                moments: false,
              });
              rows += out.facts;
            } else if (lane === "player") {
              const out = await projectProfileSeries(db, {
                playerTag: r.entity_key,
                payload,
                observedAt,
              });
              rows += out.facts;
            } else if (lane === "race") {
              const week = raceSeasonFor({
                payload,
                fetchedAt: observedAt,
              });
              if (!week || !payload?.clan?.tag) {
                tally.unresolved_season += 1;
                continue;
              }
              const out = await projectRaceSeries(db, {
                payload,
                fetchedAt: observedAt,
                ...week,
              });
              rows += out.facts;
            } else {
              rows += await fillBattleFacts(db, canonicalizeBattle, payload);
            }
          }
          const last = receipts[receipts.length - 1].receipt_id;
          await db.query(
            `update series_backfill_state
              set after_receipt_id = $2, receipts_done = receipts_done + $3,
                  rows_written = rows_written + $4, updated_at = now()
            where lane = $1`,
            [lane, last, receipts.length, rows],
          );
          await db.query("commit");
          tally.batches += 1;
          tally.receipts += receipts.length;
          tally.rows_written += rows;
          tally.next_after = Number(last);
          // The parsed cache is for refetches of the same content, which
          // sit near each other in receipt order; unbounded it held every
          // battle log of a 240 s run and the battle lane's first
          // invocation died at the Lambda's 1 GB (2026-09-17 23:18Z).
          // Oldest first, three hundred kept.
          while (parsed.size > 300) parsed.delete(parsed.keys().next().value);
          if (receipts.length < batch) {
            await db.query(
              `update series_backfill_state set finished_at = coalesce(finished_at, now()), updated_at = now()
             where lane = $1`,
              [lane],
            );
            tally.done = true;
            break;
          }
          break;
        } catch (err) {
          await db.query("rollback").catch(() => {});
          // Postgres chose this transaction as the deadlock victim: the
          // batch is whole or nothing, so replay it after a beat (the
          // parsed payloads are cached; the guards make the replay exact).
          if (err?.code === "40P01" && attempt < 3) {
            attempt += 1;
            tally.deadlock_retries += 1;
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
            continue;
          }
          throw err;
        }
      }
      if (tally.done) break;
    }
    const {
      rows: [state],
    } = await db.query(
      `select after_receipt_id, receipts_done, rows_written, started_at, finished_at
       from series_backfill_state where lane = $1`,
      [lane],
    );
    const {
      rows: [{ remaining }],
    } = await db.query(
      `select count(*)::int as remaining from api_receipt
       where endpoint = $1 and admission = 'admitted' and receipt_id > $2`,
      [endpoint, state.after_receipt_id],
    );
    return {
      ...tally,
      remaining,
      state: {
        ...state,
        after_receipt_id: Number(state.after_receipt_id),
        receipts_done: Number(state.receipts_done),
        rows_written: Number(state.rows_written),
      },
      ms: Date.now() - started,
    };
  } finally {
    await db.end();
  }
}

/** The battle lane: the ten battle columns (0131) from a log's entries,
 *  filled where null, one statement per receipt. The battle_id is the
 *  canonical one ingest computed, so a battle absent from the record
 *  (never inserted: the payload was rejected or the entry unparseable)
 *  matches nothing and is not invented. */
async function fillBattleFacts(db, canonicalizeBattle, payload) {
  if (!Array.isArray(payload)) return 0;
  const byId = new Map();
  for (const entry of payload) {
    let b;
    try {
      b = canonicalizeBattle(entry).battle;
    } catch {
      continue;
    }
    if (b?.battle_id) byId.set(b.battle_id, b);
  }
  if (byId.size === 0) return 0;
  const rows = [...byId.values()];
  const col = (c) => rows.map((b) => b[c] ?? null);
  const { rowCount } = await db.query(
    `update battle b set
       arena_id = coalesce(b.arena_id, t.arena_id),
       event_tag = coalesce(b.event_tag, t.event_tag),
       tournament_tag = coalesce(b.tournament_tag, t.tournament_tag),
       deck_selection = coalesce(b.deck_selection, t.deck_selection),
       is_ladder_tournament = coalesce(b.is_ladder_tournament, t.is_ladder_tournament),
       is_hosted_match = coalesce(b.is_hosted_match, t.is_hosted_match),
       boat_battle_side = coalesce(b.boat_battle_side, t.boat_battle_side),
       new_towers_destroyed = coalesce(b.new_towers_destroyed, t.new_towers_destroyed),
       prev_towers_destroyed = coalesce(b.prev_towers_destroyed, t.prev_towers_destroyed),
       remaining_towers = coalesce(b.remaining_towers, t.remaining_towers)
     from unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::boolean[],
                 $7::boolean[], $8::text[], $9::smallint[], $10::smallint[], $11::smallint[])
       as t(battle_id, arena_id, event_tag, tournament_tag, deck_selection, is_ladder_tournament,
            is_hosted_match, boat_battle_side, new_towers_destroyed, prev_towers_destroyed, remaining_towers)
     where b.battle_id = t.battle_id
       and (b.arena_id, b.event_tag, b.tournament_tag, b.deck_selection, b.is_ladder_tournament,
            b.is_hosted_match, b.boat_battle_side, b.new_towers_destroyed, b.prev_towers_destroyed,
            b.remaining_towers)
           is distinct from
           (coalesce(b.arena_id, t.arena_id), coalesce(b.event_tag, t.event_tag),
            coalesce(b.tournament_tag, t.tournament_tag), coalesce(b.deck_selection, t.deck_selection),
            coalesce(b.is_ladder_tournament, t.is_ladder_tournament),
            coalesce(b.is_hosted_match, t.is_hosted_match), coalesce(b.boat_battle_side, t.boat_battle_side),
            coalesce(b.new_towers_destroyed, t.new_towers_destroyed),
            coalesce(b.prev_towers_destroyed, t.prev_towers_destroyed),
            coalesce(b.remaining_towers, t.remaining_towers))`,
    [
      col("battle_id"),
      col("arena_id"),
      col("event_tag"),
      col("tournament_tag"),
      col("deck_selection"),
      col("is_ladder_tournament"),
      col("is_hosted_match"),
      col("boat_battle_side"),
      col("new_towers_destroyed"),
      col("prev_towers_destroyed"),
      col("remaining_towers"),
    ],
  );
  return rowCount;
}

/**
 * {series_census_self: {since?: '2026-03-12'}} - read-only: every
 * admitted clan receipt since the date has its day rows. Per (clan,
 * game day) with an admitted roster receipt: the clan row exists and
 * the day has member rows carrying the clan's tag. Reports the pairs,
 * the misses (first twenty named), and the same for the player lane
 * (every admitted profile receipt's day has a profile-written row) and
 * the battle lane (battles whose ten columns are all null).
 */
export async function seriesCensusSelf(databaseUrl, spec = {}) {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(spec.since ?? ""))
    ? spec.since
    : "2026-03-12";
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set transaction_read_only = on");
    await db.query("set statement_timeout = 250000");
    const {
      rows: [clan],
    } = await db.query(
      `with days as (
         select distinct r.entity_key as clan_tag, game_day(r.fetched_at) as day
         from api_receipt r
         where r.endpoint = 'clan' and r.admission = 'admitted'
           and r.fetched_at >= ($1::date)::timestamp at time zone 'UTC'),
       checked as (
         select d.clan_tag, d.day,
                exists (select 1 from clan_snapshot_daily c
                         where c.clan_tag = d.clan_tag and c.day = d.day and c.snapshot_kind = 'daily') as has_clan_row,
                exists (select 1 from player_snapshot_daily s
                         where s.clan_tag = d.clan_tag and s.snapshot_date = d.day) as has_member_rows,
                (select c.members from clan_snapshot_daily c
                  where c.clan_tag = d.clan_tag and c.day = d.day and c.snapshot_kind = 'daily') as members
         from days d)
       select count(*)::int as clan_days,
              count(distinct clan_tag)::int as clans,
              count(*) filter (where not has_clan_row)::int as missing_clan_row,
              count(*) filter (where not has_member_rows and coalesce(members, 0) > 0)::int as missing_member_rows,
              count(*) filter (where not has_member_rows and members = 0)::int as empty_clan_days,
              (select json_agg(json_build_object('clan_tag', clan_tag, 'day', day::text, 'members', members))
                 from (select clan_tag, day, members from checked
                       where not has_clan_row or (not has_member_rows and coalesce(members, 0) > 0)
                       order by day, clan_tag limit 20) m) as misses
       from checked`,
      [since],
    );
    // The misses explained: the members the record placed in that clan
    // that day (open membership over the day) and where their row for
    // the day sits - under another clan's tag means they moved clans
    // within the day and the day's last observation won.
    for (const m of clan.misses ?? []) {
      const { rows } = await db.query(
        `select cm.player_tag, s.clan_tag as row_clan_tag, s.roster_observed_at
           from clan_membership cm
           left join player_snapshot_daily s
             on s.player_tag = cm.player_tag and s.snapshot_date = $2::date and s.snapshot_kind = 'daily'
          where cm.clan_tag = $1
            and cm.joined_observed_at < ($2::date + 1)::timestamp at time zone 'UTC' + interval '10 hours'
            and (cm.left_observed_at is null
                 or cm.left_observed_at >= $2::date::timestamp at time zone 'UTC' + interval '10 hours')
          order by cm.player_tag limit 5`,
        [m.clan_tag, m.day],
      );
      m.members_that_day = rows.map((r) => ({
        player_tag: r.player_tag,
        row_clan_tag: r.row_clan_tag,
        roster_observed_at: r.roster_observed_at,
      }));
    }
    const {
      rows: [player],
    } = await db.query(
      `with days as (
         select distinct r.entity_key as player_tag, game_day(r.fetched_at) as day
         from api_receipt r
         where r.endpoint = 'player' and r.admission = 'admitted'
           and r.fetched_at >= ($1::date)::timestamp at time zone 'UTC')
       select count(*)::int as player_days,
              count(distinct player_tag)::int as players,
              count(*) filter (where not exists
                (select 1 from player_snapshot_daily s
                  where s.player_tag = d.player_tag and s.snapshot_date = d.day
                    and s.snapshot_kind = 'daily' and s.profile_observed_at is not null))::int as missing_profile_row,
              -- A profile row the 0127 columns never reached: total_donations
              -- is on every profile the API has ever served.
              count(*) filter (where exists
                (select 1 from player_snapshot_daily s
                  where s.player_tag = d.player_tag and s.snapshot_date = d.day
                    and s.snapshot_kind = 'daily' and s.profile_observed_at is not null
                    and s.total_donations is null))::int as profile_rows_without_lifetime
       from days d`,
      [since],
    );
    const {
      rows: [battle],
    } = await db.query(
      `select count(*)::int as battles,
              count(*) filter (where arena_id is null and deck_selection is null
                                 and is_ladder_tournament is null)::int as without_facts
       from battle`,
    );
    const { rows: lanes } = await db.query(
      `select lane, after_receipt_id, receipts_done, rows_written, started_at, finished_at
       from series_backfill_state order by lane`,
    );
    return { since, clan, player, battle, lanes };
  } finally {
    await db.end();
  }
}

/**
 * {explain_series: {clan_tag?, days?, player_tag?}} - read-only: EXPLAIN
 * (ANALYZE, BUFFERS) of the shapes clans_timeline, clans_members_timeline
 * and players_timeline run (contract 3.12.0), on the live database, the
 * pattern of {explain_meta} and {explain_standings}: the op that
 * explains the exact text the tool serves.
 */
export async function explainSeries(databaseUrl, spec = {}) {
  const clanTag = String(spec.clan_tag ?? "#J2RGCRVG").toUpperCase();
  const playerTag = String(spec.player_tag ?? "#20JJJ2CCRU").toUpperCase();
  const days = Math.min(365, Math.max(1, Number(spec.days ?? 180)));
  const from = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set transaction_read_only = on");
    await db.query("set statement_timeout = 120000");
    const out = [];
    const explain = async (name, text, values) => {
      const started = Date.now();
      const { rows } = await db.query(
        `explain (analyze, buffers, format text) ${text}`,
        values,
      );
      const plan = rows.map((r) => r["QUERY PLAN"]);
      out.push({
        name,
        ms: Date.now() - started,
        rows: Number(
          /actual time=[^ ]+ rows=(\d+)/.exec(plan[0] ?? "")?.[1] ?? NaN,
        ),
        execution_ms: Number(
          /Execution Time: ([\d.]+)/.exec(plan.at(-1) ?? "")?.[1] ?? NaN,
        ),
        buffers:
          /Buffers: shared hit=(\d+)(?: read=(\d+))?/
            .exec(plan.slice(0, 6).join("\n"))
            ?.slice(1, 3) ?? null,
        plan_head: plan.slice(0, 4),
      });
    };
    await explain(
      "clans_timeline: the clan rows plus the roster aggregates (default metrics)",
      `select c.day, c.snapshot_kind, c.observed_at, c.source, c.clan_score, c.clan_war_trophies,
              c.members, c.donations_per_week, c.required_trophies, a.*
         from clan_snapshot_daily c
         left join lateral (
           select sum(s.trophies)::int as total_member_trophies,
                  round(avg(s.trophies))::int as avg_member_trophies,
                  count(*) filter (where s.roster_observed_at is not null)::int as members_seen
             from player_snapshot_daily s
            where s.clan_tag = c.clan_tag and s.snapshot_date = c.day and s.snapshot_kind = c.snapshot_kind) a on true
        where c.clan_tag = $1 and c.snapshot_kind = 'daily' and c.day >= $2::date
        order by c.day`,
      [clanTag, from],
    );
    await explain(
      "clans_members_timeline: every member's rows for the window",
      `select s.player_tag, s.snapshot_date, s.snapshot_kind, s.observed_at, s.profile_observed_at,
              s.roster_observed_at, s.source, s.trophies, s.donations
         from player_snapshot_daily s
        where s.clan_tag = $1 and s.snapshot_kind = 'daily' and s.snapshot_date >= $2::date
        order by s.player_tag, s.snapshot_date`,
      [clanTag, from],
    );
    await explain(
      "players_timeline: one player's rows",
      `select snapshot_date, snapshot_kind, observed_at, profile_observed_at, roster_observed_at, source,
              trophies, wins, king_tower_level
         from player_snapshot_daily
        where player_tag = $1 and snapshot_kind = 'daily' and snapshot_date >= $2::date
        order by snapshot_date`,
      [playerTag, from],
    );
    await explain(
      "players_timeline: the progress series",
      `select p.progress_key, p.day, p.trophies from player_progress_daily p
        where p.player_tag = $1 and p.snapshot_kind = 'daily' and p.day >= $2::date
        order by p.progress_key, p.day`,
      [playerTag, from],
    );
    return {
      clan_tag: clanTag,
      player_tag: playerTag,
      days,
      from,
      explains: out,
    };
  } finally {
    await db.end();
  }
}
