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

import { gunzipSync } from 'node:zlib';
import { validateResultMessage, normalizeTag } from '@elixir-mcp/contracts';
import { payloadHash } from './hash.mjs';
import { admit } from './admission.mjs';
import { ingestBattlelog } from './battles.mjs';
import { ingestClanRoster } from './roster.mjs';

function subjectTag(endpoint, entityKey) {
  if (entityKey === 'GLOBAL') return null;
  try {
    return normalizeTag(entityKey);
  } catch {
    return null;
  }
}

const PROJECTORS = {
  async player_battlelog(db, { entityKey, receiptId, payload }) {
    const result = await ingestBattlelog(db, {
      observerTag: entityKey,
      receiptId,
      payload,
    });
    // New battles observed -> hot (elixir-bot heat model); the scheduler
    // owns decay, this is the only re-heat source for player endpoints.
    if (result.battlesInserted > 0) {
      await db.query(
        `update poll_state set heat = 3 where subject_tag = $1`,
        [entityKey],
      );
    }
    return result;
  },
  async clan(db, { receiptId: _receiptId, payload, fetchedAt }) {
    return ingestClanRoster(db, { payload, observedAt: fetchedAt });
  },
  async player(db, { entityKey, payload }) {
    // v0 projection: identity refresh + clan auto-follow stamp (§4.2).
    // The full snapshot/diff-event projector is a later build-order item.
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
    await db.query(
      `insert into player (player_tag, name, last_known_clan_tag, last_seen_at)
       values ($1, $2, $3, now())
       on conflict (player_tag) do update
         set name = coalesce(excluded.name, player.name),
             last_known_clan_tag = coalesce(excluded.last_known_clan_tag, player.last_known_clan_tag),
             last_seen_at = now()`,
      [entityKey, payload.name ?? null, clanTag],
    );
    return { projected: 'player_v0', clanTag };
  },
  async currentriverrace() {
    // War projection is V2; the receipt/payload record is the value today.
    return { projected: 'none' };
  },
};

/**
 * Process one results-queue message. Owns its transaction.
 * @returns {{outcome: string, [k: string]: unknown}}
 */
export async function processResult(db, rawMessage) {
  const validated = validateResultMessage(rawMessage);
  if (!validated.ok) return { outcome: 'bad_message', errors: validated.errors };
  const msg = validated.msg;

  if (msg.status !== 'ok') {
    // No receipt: receipts are one row per HTTP 200 (§4.3). The scheduler
    // replans on freshness; gateway health rides heartbeats/metrics.
    return { outcome: 'fetch_error', kind: msg.error?.kind ?? 'unknown' };
  }

  let payload;
  let rawText;
  try {
    rawText = gunzipSync(Buffer.from(msg.body_gzip_b64, 'base64')).toString('utf8');
    payload = JSON.parse(rawText);
  } catch (err) {
    payload = undefined;
  }

  const endpoint = msg.job.endpoint;
  const entityKey = subjectTag(endpoint, msg.job.entity_key) ?? msg.job.entity_key;
  const admission =
    payload === undefined
      ? { ok: false, errors: ['body:unparseable'] }
      : admit(endpoint, payload);
  const hash = payload === undefined ? payloadHash(rawText ?? '') : payloadHash(payload);

  await db.query('begin');
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
        admission.ok ? 'admitted' : 'rejected',
        admission.ok ? null : JSON.stringify(admission.errors),
      ],
    );
    if (receiptRows.length === 0) {
      await db.query('rollback');
      return { outcome: 'duplicate' };
    }
    const receiptId = receiptRows[0].receipt_id;

    let projection = null;
    if (admission.ok) {
      const projector = PROJECTORS[endpoint];
      projection = await projector(db, {
        entityKey,
        receiptId,
        payload,
        fetchedAt: msg.fetched_at,
      });

      // Freshness advances on admission only.
      const subject = subjectTag(endpoint, msg.job.entity_key);
      if (subject) {
        await db.query(
          `insert into poll_state (subject_tag, endpoint, last_admitted_at)
           values ($1, $2, $3)
           on conflict (subject_tag, endpoint)
             do update set last_admitted_at = excluded.last_admitted_at`,
          [subject, endpoint, msg.fetched_at],
        );
      }
    }

    await db.query('commit');
    return {
      outcome: admission.ok ? 'admitted' : 'rejected',
      receiptId,
      ...(admission.ok ? { projection } : { errors: admission.errors }),
    };
  } catch (err) {
    await db.query('rollback').catch(() => {});
    throw err;
  }
}
