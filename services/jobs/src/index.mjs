/** The jobs Lambda — scheduled product work, split out of the migrate
 *  Lambda (review item 5, 2026-09-05): EventBridge fires the sweeps and
 *  the nightly activity histogram here, so the function that can
 *  alter schema is never also the one running on a timer. Same VPC and
 *  role; deliberately no migration or seeding code paths.
 *
 *  Ops payloads: {sweep_payloads: true,
 *  sweep_operational: true} · {sweep_operational: true} ·
 *  {activity_histogram: true} · {meta_rollup_nightly: true} ·
 *  {meta_rollup_hourly: true} · {shape_census: true} · {email: "<kind>",
 *  account_id?, force?} (docs/EMAIL.md: the six product mail kinds, one
 *  EventBridge rule each; account_id + force is the account page's
 *  "send me this now") · {top100_generate: true} (the brief for the
 *  Top 100 issue, handed to the editor Lambda through the archive
 *  bucket) · {top100_accept: {key}} (the editor's answer, linted and
 *  stored as the issue to send). */

import pg from "pg";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { runEmail } from "./email/index.mjs";
import { top100Generate, top100Accept } from "./email/top100.mjs";
import { activityHistogram } from "./activity.mjs";
import { metaRollupNightly, metaRollupHourly } from "./meta-rollup.mjs";
import { shapeCensus } from "./shape-census.mjs";
import { seriesMetrics } from "./series-metrics.mjs";

/** Hourly Postgres sweep ({sweep_payloads: true}, EventBridge :15):
 *  superseded payload rows (not the latest per endpoint+entity) leave
 *  Postgres only after their S3 twin HEAD-verifies; and the JSON of any
 *  row not fetched for two hours is nulled the same way (0071/0072),
 *  because the column is a cache of the archive, not the archive - its
 *  one reader is live_fetch, seconds after admission (0076: only
 *  live-lane payloads are cached at all). Bounded per run — the next
 *  hour takes the next slice. */
export async function sweepPayloads(databaseUrl, s3override) {
  const bucket = process.env.ARCHIVE_BUCKET;
  if (!bucket) throw new Error("ARCHIVE_BUCKET not configured");
  const { archiveKey } = await import("../../ingest/src/pipeline.mjs");
  const { S3Client, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = s3override ?? new S3Client({});
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select p.payload_id, p.endpoint, p.entity_key, p.payload_hash,
              p.first_fetched_at
       from api_payload p
       where exists (select 1 from api_payload newer
                     where newer.endpoint = p.endpoint
                       and newer.entity_key = p.entity_key
                       and (newer.last_fetched_at, newer.payload_id)
                         > (p.last_fetched_at, p.payload_id))
       order by p.payload_id limit 2000`,
    );
    let swept = 0;
    let missing = 0;
    for (const r of rows) {
      const key = archiveKey(
        r.endpoint,
        r.entity_key,
        r.first_fetched_at.toISOString(),
        r.payload_hash,
      );
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        missing += 1; // no twin -> the row stays; export fills the gap
        continue;
      }
      await db.query(`delete from api_payload where payload_id = $1`, [
        r.payload_id,
      ]);
      swept += 1;
    }
    // Phase two: the cache window. Rows still holding JSON two hours
    // after their last fetch give it up once the archive has it. Only
    // live-lane payloads carry JSON at all since 0076; nothing is exempt
    // by endpoint name - the catalog and the collection are tables.
    const { rows: stale } = await db.query(
      `select payload_id, endpoint, entity_key, payload_hash, first_fetched_at
       from api_payload
       where payload_json is not null
         and last_fetched_at < now() - interval '2 hours'
       order by last_fetched_at limit 5000`,
    );
    let cleared = 0;
    let unarchived = 0; // no twin: the JSON stays, the export fills the gap
    for (const r of stale) {
      const key = archiveKey(
        r.endpoint,
        r.entity_key,
        r.first_fetched_at.toISOString(),
        r.payload_hash,
      );
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        unarchived += 1;
        continue;
      }
      await db.query(
        `update api_payload set payload_json = null where payload_id = $1`,
        [r.payload_id],
      );
      cleared += 1;
    }
    return {
      candidates: rows.length,
      swept,
      missing,
      stale: stale.length,
      cleared,
      unarchived,
    };
  } finally {
    await db.end();
  }
}

/** Operational-row sweep ({sweep_operational: true}, hourly, rides the
 *  same EventBridge rule as the payload sweep): docs/archive/DB-AUDIT-2026-09-04.md R3 — every
 *  check is already expiry-aware, these rows are pure dead weight.
 *  oauth_token keeps 90 days (not 30): rotated-token rows are the
 *  memory behind family replay detection, and 90d is the absolute
 *  family lifetime — never trim below it. */
export async function sweepOperational(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const out = {};
    out.integration_refreshes = (
      await db.query(
        "delete from integration_profile_refresh where created_at < now() - interval '1 day'",
      )
    ).rowCount;
    out.integration_usage = (
      await db.query(
        "delete from integration_usage where day < current_date - 90",
      )
    ).rowCount;
    out.rate_limit = (
      await db.query(
        `delete from rate_limit where window_start < now() - interval '7 days'`,
      )
    ).rowCount;
    // Refusals answer "is something still presenting this?", which is a
    // question about now, not about March.
    out.credential_refusal = (
      await db.query(
        `delete from credential_refusal where day < current_date - 30`,
      )
    ).rowCount;
    // The call history stays; the ADDRESS in it does not. Usage is the
    // account's own record, an IP is a person's location, and only one of
    // those has to be kept to answer "what has this credential done".
    out.viewer_ip_scrubbed = (
      await db.query(
        `update mcp_call_audit set viewer_ip = null
          where viewer_ip is not null and created_at < now() - interval '30 days'`,
      )
    ).rowCount;
    out.magic_login = (
      await db.query(
        `delete from magic_login where expires_at < now() - interval '30 days'`,
      )
    ).rowCount;
    out.session = (
      await db.query(
        `delete from session
         where sliding_expires_at < now() - interval '30 days'
            or (revoked_at is not null and revoked_at < now() - interval '30 days')`,
      )
    ).rowCount;
    out.oauth_token = (
      await db.query(
        `delete from oauth_token where expires_at < now() - interval '90 days'`,
      )
    ).rowCount;
    out.job_done = (
      await db.query(
        `delete from job where status = 'done' and done_at < now() - interval '7 days'`,
      )
    ).rowCount;
    out.collector_fetch_error = (
      await db.query(
        `delete from collector_fetch_error
         where recorded_at < now() - interval '7 days'`,
      )
    ).rowCount;
    out.job_dead = (
      await db.query(
        `delete from job where status = 'dead' and done_at < now() - interval '30 days'`,
      )
    ).rowCount;
    // An unclaimed collector bearer is a live credential sitting in
    // plaintext. Past its window it is unclaimable already (#31); this
    // stops it being READABLE too.
    out.provision_env_expired = (
      await db.query(
        `update gateway set provision_env = null, provision_expires_at = null
         where provision_env is not null and provision_expires_at <= now()`,
      )
    ).rowCount;
    out.audit_args_nulled = (
      await db.query(
        `update mcp_call_audit set args = null
         where created_at < now() - interval '90 days' and args is not null`,
      )
    ).rowCount;
    // The captured bodies follow the same 90-day rule as the arguments.
    // The objects themselves expire under the archive bucket's calls/
    // lifecycle rule (infra/template.yaml); this flips the pointer so the
    // console stops offering a body the bucket no longer has.
    out.audit_capture_expired = (
      await db.query(
        `update mcp_call_audit set captured = false
         where captured and created_at < now() - interval '90 days'`,
      )
    ).rowCount;
    return out;
  } finally {
    await db.end();
  }
}

const sqs = new SQSClient({});
async function enqueueEmail(msg) {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.EMAIL_QUEUE_URL,
      MessageBody: JSON.stringify(msg),
    }),
  );
}

export async function handler(event) {
  if (typeof event?.email === "string") {
    const result = await runEmail({
      databaseUrl: process.env.DATABASE_URL,
      kind: event.email,
      accountId: event.account_id ?? null,
      force: Boolean(event.force),
      enqueue: enqueueEmail,
      secret: process.env.SESSION_SECRET,
    });
    console.log(JSON.stringify({ email: result }));
    return result;
  }
  if (event?.top100_generate) {
    const result = await top100Generate({
      databaseUrl: process.env.DATABASE_URL,
      bucket: process.env.ARCHIVE_BUCKET,
    });
    console.log(JSON.stringify({ top100_generate: result }));
    return result;
  }
  if (event?.top100_accept) {
    const result = await top100Accept({
      databaseUrl: process.env.DATABASE_URL,
      bucket: process.env.ARCHIVE_BUCKET,
      key: event.top100_accept.key,
    });
    console.log(JSON.stringify({ top100_accept: result }));
    return result;
  }
  if (event?.shape_census) {
    const result = await shapeCensus(process.env.DATABASE_URL);
    // The nightly series line rides the same invocation (series-metrics.mjs);
    // its failure never fails the census.
    try {
      result.series_metrics = await seriesMetrics(process.env.DATABASE_URL);
    } catch (err) {
      result.series_metrics = { error: String(err?.message ?? err) };
    }
    console.log(JSON.stringify({ shape_census: result }));
    return result;
  }
  if (event?.series_metrics) {
    const result = await seriesMetrics(process.env.DATABASE_URL);
    console.log(JSON.stringify({ series_metrics: result }));
    return result;
  }
  if (event?.meta_rollup_nightly) {
    const result = await metaRollupNightly(process.env.DATABASE_URL);
    console.log(JSON.stringify({ meta_rollup_nightly: result }));
    return result;
  }
  if (event?.meta_rollup_hourly) {
    const result = await metaRollupHourly(process.env.DATABASE_URL);
    console.log(JSON.stringify({ meta_rollup_hourly: result }));
    return result;
  }
  if (event?.activity_histogram) {
    const result = await activityHistogram(process.env.DATABASE_URL);
    console.log(JSON.stringify({ activity_histogram: result }));
    return result;
  }
  if (event?.sweep_payloads) {
    const result = await sweepPayloads(process.env.DATABASE_URL);
    if (event?.sweep_operational) {
      result.operational = await sweepOperational(process.env.DATABASE_URL);
    }
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.sweep_operational) {
    const result = await sweepOperational(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  throw new Error("jobs: no recognized op in event");
}
