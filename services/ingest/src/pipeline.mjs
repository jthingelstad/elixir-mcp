/**
 * The ingest pipeline — DESIGN §5.1 admission boundary, end to end:
 *
 *   result message -> validate -> gunzip/parse -> payload (content-addressed)
 *     -> receipt (append-only, idempotent vs redelivery)
 *     -> admission -> projections -> poll_state freshness/yield
 *
 * One transaction per message: a mid-payload failure must never leave a
 * battle without its participants. Freshness advances ONLY on admission
 * (elixir-bot invariant) — a rejected payload doesn't burn the subject's
 * polling window. Fetch errors retain only a bounded operational receipt,
 * never payload data; the scheduler replans.
 */

import { gunzipSync } from "node:zlib";
import { polSeasonMonth } from "./war-clock.mjs";
import { validateResultMessage, normalizeTag } from "@elixir-mcp/contracts";
import { payloadHash } from "./hash.mjs";
import { admit } from "./admission.mjs";
import { ingestBattlelog } from "./battles.mjs";
import { ingestClanRoster } from "./roster.mjs";
import {
  projectPlayerBadges,
  projectPlayerSnapshot,
  pinArenaMoment,
} from "./snapshots.mjs";
import { refreshDailyRollups } from "./rollups.mjs";
import { projectCardCatalog, projectPlayerCards } from "./cards.mjs";
import { projectRiverRace, projectRiverRaceLog } from "./war.mjs";
import { projectModeSeasons, seasonMismatchEmf } from "./season.mjs";
import { projectClanSeries, projectPlayerProgress } from "./series.mjs";
import {
  projectRankingBoard,
  projectClanBoard,
  projectLeaderboardList,
  projectEvents,
  projectTournaments,
} from "./rankings.mjs";

/** Endpoints whose entity is a LOCATION or an ID, not a CR tag (0068/0069).
 *  poll_state is keyed by the same string the scheduler seeded - the
 *  board's location_key, a season id, a leaderboard id - so admission must
 *  stamp exactly that. Running the key through normalizeTag instead
 *  returned null for 'global', the stamp was never written, and every one
 *  of the 263 boards was STARVED on every tick from the moment 0068 shipped:
 *  re-planned every fifteen minutes, ~1,500 fetches an hour against a
 *  recorder that normally does 170. Found live at 04:19Z on 2026-09-11 from
 *  source_polls.observed_at being null on a board with two snapshots. */
const KEYED_BY_LOCATION = new Set([
  "rankings_players",
  "rankings_pol",
  "rankings_pol_season",
  "rankings_clans_loc",
  "rankings_clanwars",
  "leaderboard",
]);

function subjectTag(endpoint, entityKey) {
  if (entityKey === "GLOBAL") return null;
  if (KEYED_BY_LOCATION.has(endpoint))
    return String(entityKey ?? "").toLowerCase() || null;
  try {
    return normalizeTag(entityKey);
  } catch {
    return null;
  }
}

/** Leaderboards are recorded, not glanced at (0068, rankings.mjs):
 *  identity accretion as before, plus the board itself and the
 *  presence rows that make a top-N appearance a recording reason. */

/** Window and lookback are the scheduler's LOG_CAPACITY / LOSS_SAFETY
 *  counterpart: max battles in any 6h window over the trailing 14 days,
 *  as a per-hour rate. One indexed read of the player's recent battles
 *  (battle_participant_player_time), a window count, one row update. */
const BURST_WINDOW_HOURS = 6;
const BURST_LOOKBACK_DAYS = 14;

export async function stampBurst(db, playerTag, asOf) {
  await db.query(
    `update poll_state ps
       set burst_bph = b.bph, burst_at = $2::timestamptz
     from (
       select coalesce(max(n), 0) / ${BURST_WINDOW_HOURS}.0 as bph
       from (
         select count(*) over (
                  order by battle_time
                  range between interval '${BURST_WINDOW_HOURS} hours' preceding
                            and current row) as n
         from battle_participant
         where player_tag = $1
           and battle_time > $2::timestamptz - interval '${BURST_LOOKBACK_DAYS} days'
           and battle_time <= $2::timestamptz) w) b
     where ps.subject_tag = $1 and ps.endpoint = 'player_battlelog'`,
    [playerTag, asOf],
  );
}

/**
 * Ask for a profile the battle stream says is stale (0101). The observer's
 * own battles named an arena (see observerArena in battles.mjs for what
 * "own" costs) that the latest snapshot does not carry, and the snapshot
 * predates the battle: the profile has moved and the eight-hour cadence
 * would sit on it. The planner reads refresh_requested_at as a floor for
 * that one row. One outstanding request at a time - a stamp already past
 * the last admission stands until it is served - and the arena name is
 * compared through the catalog the profile poll itself maintains, so an
 * arena the catalog has never seen cannot ask for anything. The baseline
 * is the newest row of EITHER writer: since 2026-09-17 the roster writes
 * the member's arena at its own cadence and emits the arena_changed
 * moment itself (series.mjs), so a roster-fresh arena means the record
 * already knows and no profile poll is owed for it.
 */
async function requestProfileRefresh(
  db,
  playerTag,
  { arena, battle_time: battleTime },
  fetchedAt,
) {
  const { rowCount } = await db.query(
    `update poll_state ps set refresh_requested_at = $4::timestamptz
     from (select s.arena_id, s.observed_at
             from player_snapshot_daily s
            where s.player_tag = $1 and s.observed_at is not null
            order by s.observed_at desc limit 1) snap
     left join arena a on a.arena_id = snap.arena_id
     where ps.subject_tag = $1 and ps.endpoint = 'player'
       and snap.observed_at < $3::timestamptz
       and a.name is not null and a.name <> $2
       and (ps.refresh_requested_at is null
            or ps.refresh_requested_at <= coalesce(ps.last_admitted_at, 'epoch'))`,
    [normalizeTag(playerTag), arena, battleTime, fetchedAt],
  );
  return rowCount > 0;
}

const PROJECTORS = {
  async player_battlelog(
    db,
    { entityKey, receiptId, payload, fetchedAt, observed, filtered },
  ) {
    // Backfill guard: a replayed OLD payload is history, not activity
    // (heat retired 2026-09-05; yield_bph is the one activity signal),
    // and it neither consults nor moves the high-water mark (0073).
    const fresh = Date.parse(fetchedAt) > Date.now() - 24 * 3600_000;
    const result = await ingestBattlelog(db, {
      observerTag: entityKey,
      receiptId,
      payload,
      highWater: fresh,
      // The collector already filtered under the lease's mark: the body
      // is the new battles only, and these counts stand in for what it
      // could no longer see in the payload.
      collectorFilter:
        Number.isInteger(observed) && Number.isInteger(filtered)
          ? { observed, filtered }
          : null,
    });
    await refreshDailyRollups(db, result.affectedPairs);
    if (fresh && result.captureAudit?.audited) {
      await db.query(
        `insert into capture_audit (receipt_id, subject_tag, gap, fetched_at)
         values ($1, $2, $3, $4) on conflict do nothing`,
        [receiptId, entityKey, result.captureAudit.gap, fetchedAt],
      );
    }
    // Burst signal (0061): the fastest this player recently filled the
    // log, from battle TIMESTAMPS, so an overflowed poll still teaches
    // the true rate. Same replay guard as the yield signal below.
    if (fresh) await stampBurst(db, entityKey, fetchedAt);
    // The observer's battles named an arena (0101): if the snapshot does
    // not know it yet, the profile is owed a read now, not in eight hours.
    if (fresh && result.arenaEvidence) {
      result.profileRefreshRequested = await requestProfileRefresh(
        db,
        entityKey,
        result.arenaEvidence,
        fetchedAt,
      );
      // The roster usually sees the arena before the log delivers the
      // promoting battle: an estimated arena_changed for this arena
      // gains its battle now, once (snapshots.mjs).
      result.arenaMomentPinned = await pinArenaMoment(db, {
        playerTag: entityKey,
        arenaName: result.arenaEvidence.arena,
        fetchedAt,
      });
    }
    // Yield signal (0017): battles-per-hour EWMA, the one activity
    // number the yield scheduler ranks by. Hours are measured from the
    // last admission; replayed history is excluded (backfill guard).
    if (fresh) {
      await db.query(
        `update poll_state set yield_bph =
           case when yield_bph is null then obs.bph
                else 0.7 * yield_bph + 0.3 * obs.bph end
         from (select
             $2::numeric / greatest(
               extract(epoch from ($3::timestamptz - coalesce(
                 (select last_admitted_at from poll_state
                  where subject_tag = $1 and endpoint = 'player_battlelog'),
                 $3::timestamptz - interval '1 hour'))) / 3600.0,
               0.25) as bph) obs
         where subject_tag = $1 and endpoint = 'player_battlelog'`,
        [entityKey, result.battlesInserted, fetchedAt],
      );
    }
    return result;
  },
  async clan(db, { entityKey, receiptId, payload, fetchedAt }) {
    const { rows } = await db.query(
      `select last_admitted_at from poll_state where subject_tag = $1 and endpoint = 'clan'`,
      [entityKey],
    );
    const windowStart = rows[0]?.last_admitted_at?.toISOString() ?? null;
    const result = await ingestClanRoster(db, {
      payload,
      observedAt: fetchedAt,
      windowStart,
      receiptId,
    });
    // The series half (2026-09-17): the clan's day row and the roster
    // columns of every member's own snapshot row. Same function the
    // archive backfill calls; a roster poll that moved fifty members'
    // trophies is worth fifty facts.
    const series = await projectClanSeries(db, {
      payload,
      observedAt: fetchedAt,
      receiptId,
    });
    result.series = series;
    result.facts += series.facts;
    // The clan cadence's two inputs (2026-09-11), stamped on the clan's
    // own poll_state row the way the battlelog stamps yield_bph: hint is
    // liveliness now (active: three or more members in the game this
    // hour; idle: someone in the last day; asleep: nobody), yield_bph is
    // the EWMA of membership events per hour (joins, departures, role
    // changes) over the window since the last admission. Replayed
    // history stamps nothing.
    const fresh = Date.parse(fetchedAt) > Date.now() - 24 * 3600_000;
    if (fresh) {
      const liveliness =
        result.activeNow >= 3
          ? "active"
          : result.seen24h >= 1
            ? "idle"
            : "asleep";
      const hours = windowStart
        ? Math.max(
            (Date.parse(fetchedAt) - Date.parse(windowStart)) / 3600_000,
            1 / 60,
          )
        : null;
      const events = result.joined + result.departed + result.roleChanged;
      // Upsert: the freshness stamp that creates the row runs after the
      // projector, so a clan's first admission has no row yet.
      await db.query(
        `insert into poll_state (subject_tag, endpoint, hint, yield_bph)
         values ($1, 'clan', $2, $3::numeric)
         on conflict (subject_tag, endpoint) do update set
           hint = excluded.hint,
           yield_bph = case
             when $3::numeric is null then poll_state.yield_bph
             when poll_state.yield_bph is null then $3::numeric
             else 0.7 * poll_state.yield_bph + 0.3 * $3::numeric end`,
        [entityKey, liveliness, hours === null ? null : events / hours],
      );
    }
    return result;
  },
  async player(db, { entityKey, receiptId, payload, fetchedAt }) {
    // Identity refresh + clan auto-follow stamp (§4.2).
    let clanTag = null;
    if (payload.clan?.tag) {
      try {
        clanTag = normalizeTag(payload.clan.tag);
        // The badge belongs to the CLAN. Keep the newest non-null we
        // have seen rather than letting a payload without one erase it.
        await db.query(
          `insert into clan (clan_tag, name, badge_id) values ($1, $2, $3)
           on conflict (clan_tag) do update
             set badge_id = coalesce(excluded.badge_id, clan.badge_id)`,
          [clanTag, payload.clan.name ?? null, payload.clan.badgeId ?? null],
        );
      } catch {
        clanTag = null;
      }
    }
    // Observation-time semantics so replayed old payloads can never
    // regress identity: stamps apply only when this observation is the
    // newest; first/last_seen bracket honestly.
    const { rowCount: identityMoved } = await db.query(
      `insert into player (player_tag, name, last_known_clan_tag, first_seen_at, last_seen_at, last_known_clan_role)
       values ($1, $2, $3, $4, $4, $5)
       on conflict (player_tag) do update
         set name = case when $4 >= player.last_seen_at
                         then coalesce(excluded.name, player.name) else player.name end,
             last_known_clan_tag = case when $4 >= player.last_seen_at
                         then coalesce(excluded.last_known_clan_tag, player.last_known_clan_tag)
                         else player.last_known_clan_tag end,
             last_known_clan_role = case when $4 >= player.last_seen_at
                         then excluded.last_known_clan_role
                         else player.last_known_clan_role end,
             first_seen_at = least(player.first_seen_at, $4),
             last_seen_at = greatest(player.last_seen_at, $4)
       -- Only when the identity moves, or the sighting is a DAY stale:
       -- a profile poll that changed nothing must not rewrite the row
       -- (1.4M updates on 157k rows before 2026-09-11; hourly touches
       -- were still 6.6k updates an hour on 2026-09-12). Safe for the
       -- ordering above: an identity change always stamps last_seen_at
       -- exactly, so an older payload can never pass the $4 >= guard
       -- past a newer name; only the no-change touch is coarse.
       where $4 < player.last_seen_at
          or player.name is distinct from coalesce(excluded.name, player.name)
          or player.last_known_clan_tag is distinct from
             coalesce(excluded.last_known_clan_tag, player.last_known_clan_tag)
          or player.last_known_clan_role is distinct from excluded.last_known_clan_role
          or player.first_seen_at > $4
          or player.last_seen_at < $4::timestamptz - interval '1 day'`,
      // The role is the player's own account of their standing in the
      // clan they are in NOW. Unlike the tag it is not coalesced: a
      // player who left has no role, and saying so is the honest read.
      [
        entityKey,
        payload.name ?? null,
        clanTag,
        fetchedAt,
        clanTag ? (payload.role ?? null) : null,
      ],
    );
    // Tenure from the YearsPlayed badge (0024): level = completed years,
    // progress = account age in days. Absent badge = UNKNOWN (verified
    // absent on 4+year accounts too) - never write zero, never null-out
    // a previously known value on an absent read.
    const yearsBadge = (payload.badges ?? []).find(
      (b) => b?.name === "YearsPlayed",
    );
    if (yearsBadge && Number.isFinite(Number(yearsBadge.level))) {
      await db.query(
        `update player set years_played = $2, account_age_days = $3
         where player_tag = $1
           and (years_played is distinct from $2 or account_age_days is distinct from $3)`,
        [
          entityKey,
          Number(yearsBadge.level),
          Number.isFinite(Number(yearsBadge.progress))
            ? Number(yearsBadge.progress)
            : null,
        ],
      );
    }
    const badges = await projectPlayerBadges(db, {
      playerTag: entityKey,
      payload,
      fetchedAt,
    });
    const snapshot = await projectPlayerSnapshot(db, {
      playerTag: entityKey,
      payload,
      fetchedAt,
      receiptId,
    });
    // The collection (0076): cards and tower troops, levels on the
    // display scale, with card_unlocked / card_leveled nods.
    const cards = await projectPlayerCards(db, {
      playerTag: entityKey,
      payload,
      fetchedAt,
    });
    // The side-mode season keys the profile carries (0104), verbatim,
    // and the buckets' values as a series (0129).
    const modes = await projectModeSeasons(db, { payload, fetchedAt });
    const progress = await projectPlayerProgress(db, {
      playerTag: entityKey,
      payload,
      observedAt: fetchedAt,
    });
    return {
      projected: "player",
      clanTag,
      snapshot,
      cardsChanged: cards.changed,
      progress,
      facts:
        identityMoved +
        badges.changed +
        cards.changed +
        modes.changed +
        snapshot.facts +
        progress.facts,
    };
  },
  async currentriverrace(db, { entityKey, payload, fetchedAt }) {
    // Cadence hint (0017, its own column since 0110): the payload names
    // the period type; war days poll tight, training days relax — no
    // inference required, and no check on the API's enum.
    if (payload.periodType) {
      await db.query(
        `update poll_state set period_type = $2
         where subject_tag = $1 and endpoint = 'currentriverrace'
           and period_type is distinct from $2`,
        [entityKey, payload.periodType],
      );
    }
    // Split timing: the census showed this projector at seconds and the
    // first fix (0015) missed — attribute before optimizing again. The
    // war-key stamper that followed it retired with 0105: a battle's
    // week and day are its battle_time on the war_period grid.
    const t0 = Date.now();
    const race = await projectRiverRace(db, {
      clanTag: entityKey,
      payload,
      fetchedAt,
    });
    return {
      ...race,
      phase_race_ms: Date.now() - t0,
    };
  },
  async riverracelog(db, { entityKey, payload, emitMetrics }) {
    const log = await projectRiverRaceLog(db, { clanTag: entityKey, payload });
    // The season row's derived war number against the API's own (0104):
    // a mismatch is one EMF count for the alarm and the receipt's
    // projection carries it; nothing is relabelled.
    for (const m of log.season_mismatches ?? []) {
      console.error("season_war_id_mismatch", JSON.stringify(m));
      emitMetrics?.(`${seasonMismatchEmf(m)}\n`);
    }
    return log;
  },
  async rankings_players(db, { entityKey, receiptId, payload, fetchedAt }) {
    return projectRankingBoard(db, {
      board: "trophy",
      entityKey,
      receiptId,
      payload,
      fetchedAt,
    });
  },
  async rankings_pol(db, { entityKey, receiptId, payload, fetchedAt }) {
    return projectRankingBoard(db, {
      board: "pol",
      entityKey,
      receiptId,
      payload,
      fetchedAt,
    });
  },
  // 0069: the finals, the clan ladders, the game-mode boards, what is on.
  async rankings_pol_season(db, { entityKey, receiptId, payload, fetchedAt }) {
    // The key is the API's month (2026-08), or - from a hand live_fetch -
    // its numeric list position; the ordinal the record files it under is
    // the game clock's (0070).
    const seasonMonth = polSeasonMonth(entityKey);
    if (!seasonMonth) return { projected: "none" };
    return projectRankingBoard(db, {
      board: "pol_final",
      entityKey: seasonMonth,
      receiptId,
      payload,
      fetchedAt,
      seasonMonth,
    });
  },
  async rankings_clans_loc(db, { entityKey, receiptId, payload, fetchedAt }) {
    return projectClanBoard(db, {
      board: "clans",
      entityKey,
      receiptId,
      payload,
      fetchedAt,
    });
  },
  async rankings_clanwars(db, { entityKey, receiptId, payload, fetchedAt }) {
    return projectClanBoard(db, {
      board: "clanwars",
      entityKey,
      receiptId,
      payload,
      fetchedAt,
    });
  },
  async leaderboards(db, { payload }) {
    return projectLeaderboardList(db, { payload });
  },
  async leaderboard(db, { entityKey, receiptId, payload, fetchedAt }) {
    return projectRankingBoard(db, {
      board: "mode",
      entityKey,
      receiptId,
      payload,
      fetchedAt,
    });
  },
  async events(db, { payload, fetchedAt }) {
    return projectEvents(db, { payload, fetchedAt });
  },
  async globaltournaments(db, { payload, fetchedAt }) {
    return projectTournaments(db, { payload, fetchedAt });
  },
  async cards(db, { payload, fetchedAt }) {
    // The catalog is a table (0076); cards_catalog and the resources door
    // read it there, never the payload cache.
    const { changed } = await projectCardCatalog(db, { payload, fetchedAt });
    return { projected: "cards", changed, facts: changed };
  },
};

/**
 * S3 archive key for one payload (docs/archive/DATA-TOOLS-2026-09-04.md §1): Hive-partitioned by
 * endpoint/entity/fetch date so Athena and DuckDB read the layout with
 * no catalog crawl. Content-addressed — the hash rides the filename.
 */
export function archiveKey(endpoint, entityKey, fetchedAt, hash) {
  const entity = entityKey.replace(/^#/, "");
  const dt = fetchedAt.slice(0, 10);
  const stamp = fetchedAt.replace(/[-:]/g, "").replace(/\.\d+/, "");
  return `payloads/endpoint=${endpoint}/entity=${entity}/dt=${dt}/${stamp}-${hash.slice(0, 16)}.json.gz`;
}

/**
 * Process one results-queue message. Owns its transaction.
 * `deps.archive` (optional) is the S3 payload archive: NEW payload
 * content is put before commit, so a committed row always has its S3
 * twin (an orphan object from a rolled-back txn is harmless; the
 * reverse is not). Put failure fails the message -> SQS retry — the
 * archive is part of admission, not best-effort (docs/archive/DATA-TOOLS-2026-09-04.md §1).
 * @returns {{outcome: string, [k: string]: unknown}}
 */
// Bound on the DECOMPRESSED body (issue #4). The largest legitimate CR
// payload is now a season's FINAL Path of Legends board: 9,999 places,
// about 1.5 MB raw (0069) - the 2 MiB this used to be cleared it by a
// third, and a longer-named field would not have. 16 MiB is a hard
// ceiling against a malicious or broken submission expanding past the
// web API Lambda's 512 MB, not a size anything real approaches. Enforced
// inside zlib, before any string or JSON work.
const MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024;

export async function processResult(db, rawMessage, deps = {}) {
  // Phase timings ride every outcome (a few Date.now() calls): the
  // replay lane aggregates them, and they price the live path too.
  const t0 = Date.now();
  const timings = {};
  const mark = (key, since) => {
    timings[key] = (timings[key] ?? 0) + (Date.now() - since);
    return Date.now();
  };
  const validated = validateResultMessage(rawMessage);
  if (!validated.ok)
    return { outcome: "bad_message", errors: validated.errors };
  const msg = validated.msg;

  // Lifecycle enforcement (§4.6): revocation is real because ingest stops
  // listening. Unknown ids die here too — cheaper than an FK throw + retry.
  // Any valid message proves liveness; success is stamped on admission below.
  const { rows: gwRows } = await db.query(
    `update gateway set last_heartbeat_at = now(),
            last_seen_sha = coalesce($2, last_seen_sha)
     where gateway_id::text = $1 and status <> 'revoked'
     returning status`,
    [msg.gateway_id, rawMessage?.gateway_sha ?? null],
  );
  if (gwRows.length === 0) {
    return { outcome: "gateway_refused", gateway_id: msg.gateway_id };
  }

  if (msg.status !== "ok") {
    // API receipts remain one row per HTTP 200 (§4.3), but a non-200 must
    // leave a compact, no-payload operational receipt. Otherwise a planned
    // board that never admits is indistinguishable from a collector that
    // never received the work. Freshness still does not move.
    const kind = msg.error?.kind ?? "unknown";
    await db.query(
      `insert into collector_fetch_error
         (job_id, gateway_id, endpoint, entity_key, fetched_at, http_status, error_kind)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (gateway_id, endpoint, entity_key, fetched_at) do nothing`,
      [
        Number.isInteger(msg.job_id) ? msg.job_id : null,
        msg.gateway_id,
        msg.job.endpoint,
        msg.job.entity_key,
        msg.fetched_at,
        Number.isInteger(msg.http_status) ? msg.http_status : null,
        kind,
      ],
    );
    return { outcome: "fetch_error", kind };
  }

  let t = mark("gateway_ms", t0);
  let payload;
  let rawText;
  let tooLarge = false;
  try {
    rawText = gunzipSync(Buffer.from(msg.body_gzip_b64, "base64"), {
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
    }).toString("utf8");
    payload = JSON.parse(rawText);
  } catch (err) {
    // zlib aborts at the bound with ERR_BUFFER_TOO_LARGE — a deliberate,
    // observable rejection, not an allocation.
    tooLarge = err?.code === "ERR_BUFFER_TOO_LARGE";
    payload = undefined;
  }

  const endpoint = msg.job.endpoint;
  const entityKey =
    subjectTag(endpoint, msg.job.entity_key) ?? msg.job.entity_key;
  const admission =
    payload === undefined
      ? {
          ok: false,
          errors: [tooLarge ? "body:too_large" : "body:unparseable"],
        }
      : admit(endpoint, payload, entityKey);
  const hash =
    payload === undefined
      ? payloadHash(tooLarge ? msg.body_gzip_b64 : (rawText ?? ""))
      : payloadHash(payload);
  t = mark("parse_admit_ms", t);

  await db.query("begin");
  try {
    if (payload !== undefined) {
      // xmax = 0 marks a genuine insert (vs the dedup update path):
      // only NEW content goes to the S3 archive — content-identical
      // refetches add a receipt, never an object.
      //
      // The JSON column is a cache for a reader that is waiting on this
      // exact payload, and the only such reader is live_fetch, on the
      // live lane, within seconds (0071/0072 made it a two-hour cache;
      // 2026-09-11: every bulk payload was still written to TOAST and
      // nulled two hours later for nobody - ~60 KB per profile poll).
      // A LANE rule, not an endpoint one: bulk payloads keep the hash
      // row for dedup and go to S3; every product-facing datum has its
      // own projection, and tools never read this column.
      const cacheJson = msg.job.lane === "live";
      const {
        rows: [payloadRow],
      } = await db.query(
        `insert into api_payload (endpoint, entity_key, payload_hash, payload_json, first_fetched_at)
         values ($1, $2, $3, $4, $5)
         on conflict (endpoint, entity_key, payload_hash)
           do update set last_fetched_at = now(),
             -- A live refetch of content the sweep has already nulled
             -- puts it back for live_fetch to read.
             payload_json = coalesce(api_payload.payload_json, excluded.payload_json)
         returning (xmax = 0) as fresh_content`,
        // first_fetched_at is the COLLECTOR's fetch time, not ingest
        // now(): the S3 archive key below is built from it, and the
        // weekly sweep reconstructs that key from this column — the
        // two must agree or every twin lookup misses (sol-6 finding 6).
        [
          endpoint,
          entityKey,
          hash,
          cacheJson ? JSON.stringify(payload) : null,
          msg.fetched_at,
        ],
      );
      if (payloadRow.fresh_content && deps.archive) {
        await deps.archive.put(
          archiveKey(endpoint, entityKey, msg.fetched_at, hash),
          Buffer.from(msg.body_gzip_b64, "base64"),
        );
        t = mark("archive_ms", t);
      }
    }

    const { rows: receiptRows } = await db.query(
      `insert into api_receipt
         (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission, admission_errors, job_id, observed, filtered, api_bytes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (gateway_id, endpoint, entity_key, fetched_at) do nothing
       returning receipt_id`,
      [
        endpoint,
        entityKey,
        msg.fetched_at,
        hash,
        msg.gateway_id,
        admission.ok ? "admitted" : "rejected",
        admission.ok ? null : admission.errors.map((e) => String(e)),
        Number.isInteger(msg.job_id) ? msg.job_id : null,
        Number.isInteger(msg.observed) ? msg.observed : null,
        Number.isInteger(msg.filtered) ? msg.filtered : null,
        Number.isInteger(msg.api_bytes) ? msg.api_bytes : null,
      ],
    );
    if (receiptRows.length === 0) {
      await db.query("rollback");
      return { outcome: "duplicate", timings };
    }
    const receiptId = receiptRows[0].receipt_id;
    t = mark("store_ms", t);

    let projection = null;
    // deps.skipProjection: receipt and archive only. The roster history
    // replay (2026-09-15) needs old clan payloads on the record - receipts
    // under the backfill gateway, bodies in S3 - without running the
    // membership state machine, which only runs forward: an old roster
    // diffed against today's open rows is six months of false joins.
    if (admission.ok && !deps.skipProjection) {
      const projector = PROJECTORS[endpoint];
      projection = await projector(db, {
        entityKey,
        receiptId,
        payload,
        fetchedAt: msg.fetched_at,
        observed: msg.observed,
        filtered: msg.filtered,
        // EMF on stdout, the scheduler's pattern: injectable, never
        // awaited on a network, default the process's own stdout.
        emitMetrics: deps.emitMetrics ?? ((line) => process.stdout.write(line)),
      });
      t = mark("project_ms", t);
    }
    if (admission.ok) {
      // What the fetch was worth (0077): the projection's own count of
      // rows it inserted or changed, and the transaction's wall time so
      // far. A point rewards a fetch that returned data, never one that
      // repeated what was held (Jamie, 2026-09-11).
      const facts = Number.isInteger(projection?.facts) ? projection.facts : 0;
      await db.query(
        `update api_receipt set new_facts = $2, ingest_ms = $3 where receipt_id = $1`,
        [receiptId, facts, Date.now() - t0],
      );
      await db.query(
        `update gateway set last_success_at = now(),
                fetch_points = fetch_points + case when $2 > 0 then 1 else 0 end
         where gateway_id::text = $1`,
        [msg.gateway_id, facts],
      );

      // Freshness advances on admission only. GLOBAL (the card catalog)
      // is a subject too — without this it replans on cadence alone and
      // a failed fetch waits a full day.
      const subject =
        msg.job.entity_key === "GLOBAL"
          ? "GLOBAL"
          : subjectTag(endpoint, msg.job.entity_key);
      if (subject) {
        await db.query(
          `insert into poll_state (subject_tag, endpoint, last_admitted_at)
           values ($1, $2, $3)
           on conflict (subject_tag, endpoint)
             do update set last_admitted_at =
               greatest(coalesce(poll_state.last_admitted_at, 'epoch'), excluded.last_admitted_at)`,
          [subject, endpoint, msg.fetched_at],
        );
      }
    }

    await db.query("commit");
    mark("commit_ms", t);
    timings.total_ms = Date.now() - t0;
    return {
      outcome: admission.ok ? "admitted" : "rejected",
      receiptId,
      timings,
      ...(admission.ok ? { projection } : { errors: admission.errors }),
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}
