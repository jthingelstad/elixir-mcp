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
      await db.query(
        `update poll_state set heat = 3, heat_updated_at = now() where subject_tag = $1`,
        [entityKey],
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
    const snapshot = await projectPlayerSnapshot(db, {
      playerTag: entityKey,
      payload,
      fetchedAt,
      receiptId,
    });
    return { projected: "player", clanTag, snapshot };
  },
  async currentriverrace(db, { entityKey, payload, fetchedAt }) {
    const race = await projectRiverRace(db, {
      clanTag: entityKey,
      payload,
      fetchedAt,
    });
    const stamps = await stampWarKeys(db, {
      clanTag: entityKey,
      payload,
      nowMs: Date.parse(fetchedAt),
    });
    return { ...race, warKeysStamped: stamps.stamped };
  },
  async riverracelog(db, { entityKey, payload }) {
    return projectRiverRaceLog(db, { clanTag: entityKey, payload });
  },
  async cards() {
    // The catalog is served straight from the payload store (get_card_catalog).
    return { projected: "none" };
  },
};

/**
 * Process one results-queue message. Owns its transaction.
 * @returns {{outcome: string, [k: string]: unknown}}
 */
export async function processResult(db, rawMessage) {
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
    `update gateway set last_heartbeat_at = now()
     where gateway_id::text = $1 and status <> 'revoked'
     returning status`,
    [msg.gateway_id],
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
      await db.query(
        `insert into api_payload (endpoint, entity_key, payload_hash, payload_json)
         values ($1, $2, $3, $4)
         on conflict (endpoint, entity_key, payload_hash)
           do update set last_fetched_at = now()`,
        [endpoint, entityKey, hash, JSON.stringify(payload)],
      );
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
