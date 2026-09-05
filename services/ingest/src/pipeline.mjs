/**
 * The ingest pipeline — DESIGN §5.1 admission boundary, end to end:
 *
 *   result message -> validate -> gunzip/parse -> payload (content-addressed)
 *     -> receipt (append-only, idempotent vs redelivery)
 *     -> admission -> projections -> poll_state freshness/heat
 *
 * One transaction per message: a mid-payload failure must never leave a
 * battle without its participants. Freshness advances ONLY on admission
 * (elixir-bot invariant) — a rejected payload doesn't burn the subject's
 * polling window. Fetch errors write nothing durable; the scheduler replans.
 */

import { emitToTagWatchers } from "../../mcp/src/feed.mjs";
import { gunzipSync } from "node:zlib";
import { validateResultMessage, normalizeTag } from "@elixir-mcp/contracts";
import { payloadHash } from "./hash.mjs";
import { admit } from "./admission.mjs";
import { ingestBattlelog } from "./battles.mjs";
import { ingestClanRoster } from "./roster.mjs";
import { projectPlayerSnapshot } from "./snapshots.mjs";
import { refreshDailyRollups } from "./rollups.mjs";
import { projectRiverRace, projectRiverRaceLog, stampWarKeys } from "./war.mjs";

function subjectTag(endpoint, entityKey) {
  if (entityKey === "GLOBAL") return null;
  try {
    return normalizeTag(entityKey);
  } catch {
    return null;
  }
}

/** Leaderboard payloads accrete identity (agent feedback #6): every
 *  ranked tag lands a player row (name fill-null-only), so top-N tags
 *  are immediately addressable by the player tools. */
async function projectRankings(db, payload) {
  const items = (payload?.items ?? []).filter((i) => i?.tag);
  if (items.length === 0) return { projected: "rankings", players: 0 };
  const tags = [];
  const names = [];
  for (const i of items) {
    try {
      tags.push(normalizeTag(i.tag));
      names.push(i.name ?? null);
    } catch {
      /* skip malformed tags */
    }
  }
  await db.query(
    `insert into player (player_tag, name)
     select t.tag, t.name from unnest($1::text[], $2::text[]) as t(tag, name)
     on conflict (player_tag) do update set
       last_seen_at = now(),
       name = coalesce(player.name, excluded.name)`,
    [tags, names],
  );
  return { projected: "rankings", players: tags.length };
}

const PROJECTORS = {
  async player_battlelog(db, { entityKey, receiptId, payload, fetchedAt }) {
    const result = await ingestBattlelog(db, {
      observerTag: entityKey,
      receiptId,
      payload,
    });
    await refreshDailyRollups(db, result.affectedPairs);
    // New battles observed -> hot (elixir-bot heat model); the scheduler
    // owns decay, this is the only re-heat source for player endpoints.
    // Backfill guard: a replayed OLD payload is history, not activity.
    const fresh = Date.parse(fetchedAt) > Date.now() - 24 * 3600_000;
    if (fresh && result.battlesInserted > 0) {
      // Push lane: one coalesced event per capture, fanned out to the
      // accounts watching this tag (backfill-guarded like heat).
      await emitToTagWatchers(db, entityKey, "battles_recorded", {
        count: result.battlesInserted,
      });
      await db.query(
        `update poll_state set heat = 3, heat_updated_at = now() where subject_tag = $1`,
        [entityKey],
      );
    }
    // Yield signal (0017): battles-per-hour EWMA, the one activity
    // number the yield scheduler ranks by. Hours are measured from the
    // last admission; replayed history is excluded like re-heat is.
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
    return ingestClanRoster(db, {
      payload,
      observedAt: fetchedAt,
      windowStart,
      receiptId,
    });
  },
  async player(db, { entityKey, receiptId, payload, fetchedAt }) {
    // Identity refresh + clan auto-follow stamp (§4.2).
    let clanTag = null;
    if (payload.clan?.tag) {
      try {
        clanTag = normalizeTag(payload.clan.tag);
        await db.query(
          `insert into clan (clan_tag, name) values ($1, $2) on conflict (clan_tag) do nothing`,
          [clanTag, payload.clan.name ?? null],
        );
      } catch {
        clanTag = null;
      }
    }
    // Observation-time semantics so replayed old payloads can never
    // regress identity: stamps apply only when this observation is the
    // newest; first/last_seen bracket honestly.
    await db.query(
      `insert into player (player_tag, name, last_known_clan_tag, first_seen_at, last_seen_at)
       values ($1, $2, $3, $4, $4)
       on conflict (player_tag) do update
         set name = case when $4 >= player.last_seen_at
                         then coalesce(excluded.name, player.name) else player.name end,
             last_known_clan_tag = case when $4 >= player.last_seen_at
                         then coalesce(excluded.last_known_clan_tag, player.last_known_clan_tag)
                         else player.last_known_clan_tag end,
             first_seen_at = least(player.first_seen_at, $4),
             last_seen_at = greatest(player.last_seen_at, $4)`,
      [entityKey, payload.name ?? null, clanTag, fetchedAt],
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
         where player_tag = $1`,
        [
          entityKey,
          Number(yearsBadge.level),
          Number.isFinite(Number(yearsBadge.progress))
            ? Number(yearsBadge.progress)
            : null,
        ],
      );
    }
    const snapshot = await projectPlayerSnapshot(db, {
      playerTag: entityKey,
      payload,
      fetchedAt,
      receiptId,
    });
    return { projected: "player", clanTag, snapshot };
  },
  async currentriverrace(db, { entityKey, payload, fetchedAt }) {
    // Cadence hint (0017): the payload names the period type; war days
    // poll tight, training days relax — no inference required.
    if (payload.periodType) {
      await db.query(
        `update poll_state set hint = $2
         where subject_tag = $1 and endpoint = 'currentriverrace'`,
        [entityKey, payload.periodType],
      );
    }
    // Split timing: the census showed this projector at seconds and the
    // first fix (0015) missed — attribute before optimizing again.
    const t0 = Date.now();
    const race = await projectRiverRace(db, {
      clanTag: entityKey,
      payload,
      fetchedAt,
    });
    const t1 = Date.now();
    const stamps = await stampWarKeys(db, {
      clanTag: entityKey,
      payload,
      nowMs: Date.parse(fetchedAt),
    });
    return {
      ...race,
      warKeysStamped: stamps.stamped,
      phase_race_ms: t1 - t0,
      phase_stamp_ms: Date.now() - t1,
    };
  },
  async riverracelog(db, { entityKey, payload }) {
    return projectRiverRaceLog(db, { clanTag: entityKey, payload });
  },
  async rankings_players(db, { payload }) {
    return projectRankings(db, payload);
  },
  async rankings_pol(db, { payload }) {
    return projectRankings(db, payload);
  },
  async cards() {
    // The catalog is served straight from the payload store (get_card_catalog).
    return { projected: "none" };
  },
};

/**
 * S3 archive key for one payload (DATA-TOOLS §1): Hive-partitioned by
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
 * archive is part of admission, not best-effort (DATA-TOOLS §1).
 * @returns {{outcome: string, [k: string]: unknown}}
 */
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
    // No receipt: receipts are one row per HTTP 200 (§4.3). The scheduler
    // replans on freshness; gateway health rides heartbeats/metrics.
    return { outcome: "fetch_error", kind: msg.error?.kind ?? "unknown" };
  }

  let t = mark("gateway_ms", t0);
  let payload;
  let rawText;
  try {
    rawText = gunzipSync(Buffer.from(msg.body_gzip_b64, "base64")).toString(
      "utf8",
    );
    payload = JSON.parse(rawText);
  } catch {
    payload = undefined;
  }

  const endpoint = msg.job.endpoint;
  const entityKey =
    subjectTag(endpoint, msg.job.entity_key) ?? msg.job.entity_key;
  const admission =
    payload === undefined
      ? { ok: false, errors: ["body:unparseable"] }
      : admit(endpoint, payload);
  const hash =
    payload === undefined ? payloadHash(rawText ?? "") : payloadHash(payload);
  t = mark("parse_admit_ms", t);

  await db.query("begin");
  try {
    if (payload !== undefined) {
      // xmax = 0 marks a genuine insert (vs the dedup update path):
      // only NEW content goes to the S3 archive — content-identical
      // refetches add a receipt, never an object.
      const {
        rows: [payloadRow],
      } = await db.query(
        `insert into api_payload (endpoint, entity_key, payload_hash, payload_json)
         values ($1, $2, $3, $4)
         on conflict (endpoint, entity_key, payload_hash)
           do update set last_fetched_at = now()
         returning (xmax = 0) as fresh_content`,
        [endpoint, entityKey, hash, JSON.stringify(payload)],
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
         (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission, admission_errors)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (gateway_id, endpoint, entity_key, fetched_at) do nothing
       returning receipt_id`,
      [
        endpoint,
        entityKey,
        msg.fetched_at,
        hash,
        msg.gateway_id,
        admission.ok ? "admitted" : "rejected",
        admission.ok ? null : JSON.stringify(admission.errors),
      ],
    );
    if (receiptRows.length === 0) {
      await db.query("rollback");
      return { outcome: "duplicate", timings };
    }
    const receiptId = receiptRows[0].receipt_id;
    t = mark("store_ms", t);

    let projection = null;
    if (admission.ok) {
      await db.query(
        `update gateway set last_success_at = now(), fetch_points = fetch_points + 1
         where gateway_id::text = $1`,
        [msg.gateway_id],
      );
      const projector = PROJECTORS[endpoint];
      projection = await projector(db, {
        entityKey,
        receiptId,
        payload,
        fetchedAt: msg.fetched_at,
      });
      t = mark("project_ms", t);

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
