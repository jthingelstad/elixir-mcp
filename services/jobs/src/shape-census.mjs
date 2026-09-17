/**
 * The nightly shape census ({shape_census: true}, EventBridge 05:05Z;
 * docs/ENGINEERING.md "Ingest invariants", time-series review 2.7,
 * decided by Jamie 2026-09-17). Out of band from ingestion: it reads a
 * sample of the day's archived objects per endpoint (twenty, the newest
 * first, by the api_payload rows fetched in the last day) and compares
 * their field sets to the manifest (services/ingest/src/payload-keys.mjs).
 * Two findings per endpoint: a field present in the sample and absent
 * from the manifest (the API added something), and a manifest field
 * absent from every sampled payload for seven days (the API retired
 * something, as expLevel was). Each is filed once into feedback under
 * the owner account (category data_quality, surface recorder),
 * deduplicated on (endpoint, path) while an item is open, for Close the
 * Loop to turn into the change; the run emits ElixirMCP/Record
 * PayloadShapeFindings. Nothing mails anyone. On a correct manifest a
 * night files nothing.
 */

import pg from "pg";
import { gunzipSync } from "node:zlib";
import {
  PAYLOAD_KEYS,
  payloadPaths,
  dispositionOf,
  expectedPaths,
} from "../../ingest/src/payload-keys.mjs";
import { archiveKey } from "../../ingest/src/pipeline.mjs";

const SAMPLE = 20;
const ABSENT_DAYS = 7;
const OPEN = ["new", "seen", "planned"];

function shapeFindingsEmf(count, now = Date.now()) {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: "ElixirMCP/Record",
          Dimensions: [[]],
          Metrics: [{ Name: "PayloadShapeFindings", Unit: "Count" }],
        },
      ],
    },
    PayloadShapeFindings: count,
  });
}

/** `deps.getObject(key) -> Buffer` (gzip) and `deps.emitMetrics` are
 *  injectable for the tests; the Lambda uses S3 and stdout. */
export async function shapeCensus(databaseUrl, deps = {}) {
  const bucket = process.env.ARCHIVE_BUCKET;
  let getObject = deps.getObject;
  if (!getObject) {
    if (!bucket) throw new Error("ARCHIVE_BUCKET not configured");
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({});
    getObject = async (key) => {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return Buffer.from(await res.Body.transformToByteArray());
    };
  }
  const emitMetrics =
    deps.emitMetrics ?? ((line) => process.stdout.write(line));
  const now = deps.now ? new Date(deps.now) : new Date();
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  try {
    const {
      rows: [owner],
    } = await db.query(
      `select account_id from account where is_owner order by created_at limit 1`,
    );
    const report = { endpoints: {}, findings: [], filed: 0, already_open: 0 };
    for (const endpoint of Object.keys(PAYLOAD_KEYS)) {
      const { rows: sample } = await db.query(
        `select entity_key, payload_hash, first_fetched_at
         from api_payload
         where endpoint = $1 and last_fetched_at >= $2::timestamptz - interval '1 day'
         order by last_fetched_at desc limit $3`,
        [endpoint, now, SAMPLE],
      );
      const seenIn = new Map(); // path -> payloads carrying it
      let read = 0;
      let unreadable = 0;
      for (const r of sample) {
        const key = archiveKey(
          endpoint,
          r.entity_key,
          r.first_fetched_at.toISOString(),
          r.payload_hash,
        );
        let payload;
        try {
          payload = JSON.parse(
            gunzipSync(await getObject(key)).toString("utf8"),
          );
        } catch {
          unreadable += 1;
          continue;
        }
        read += 1;
        for (const p of payloadPaths(payload))
          seenIn.set(p, (seenIn.get(p) ?? 0) + 1);
      }
      const ep = {
        sampled: sample.length,
        read,
        unreadable,
        new_fields: [],
        absent_fields: [],
      };
      report.endpoints[endpoint] = ep;
      if (read === 0) continue;

      // The memory: every path seen tonight.
      const paths = [...seenIn.keys()].sort();
      await db.query(
        `insert into payload_shape_seen (endpoint, path, first_seen_at, last_seen_at)
         select $1, unnest($2::text[]), $3::timestamptz, $3::timestamptz
         on conflict (endpoint, path) do update set last_seen_at = excluded.last_seen_at`,
        [endpoint, paths, now],
      );

      for (const p of paths)
        if (!dispositionOf(endpoint, p))
          ep.new_fields.push({ path: p, seen_in: seenIn.get(p) });

      // Absent for seven days: the memory says the path was seen once
      // and not since ABSENT_DAYS ago; a path never seen since the
      // census began is reported only once the census itself is that
      // old for this endpoint.
      const { rows: memory } = await db.query(
        `select path, last_seen_at, first_seen_at from payload_shape_seen where endpoint = $1`,
        [endpoint],
      );
      const lastSeen = new Map(memory.map((m) => [m.path, m.last_seen_at]));
      const censusSince = memory.reduce(
        (min, m) =>
          min === null || m.first_seen_at < min ? m.first_seen_at : min,
        null,
      );
      const cutoff = now.getTime() - ABSENT_DAYS * 86_400_000;
      for (const p of expectedPaths(endpoint)) {
        if (seenIn.has(p)) continue;
        const last = lastSeen.get(p);
        const stale = last
          ? last.getTime() < cutoff
          : censusSince && censusSince.getTime() < cutoff;
        if (stale)
          ep.absent_fields.push({
            path: p,
            last_seen: last ? last.toISOString() : null,
          });
      }

      for (const f of ep.new_fields)
        report.findings.push({
          endpoint,
          path: f.path,
          sample_type: "new_field",
          seen_in: f.seen_in,
          sampled: read,
          message: `${endpoint}: the API sends ${f.path} (in ${f.seen_in} of ${read} sampled payloads) and payload-keys.mjs has no disposition for it. Decide where it lands or why not, project it, bump the contract, update the docs and cr-agent-api-docs.`,
        });
      for (const f of ep.absent_fields)
        report.findings.push({
          endpoint,
          path: f.path,
          sample_type: "absent_field",
          seen_in: 0,
          sampled: read,
          message: `${endpoint}: ${f.path} is in payload-keys.mjs and absent from every sampled payload for ${ABSENT_DAYS} days (last seen ${f.last_seen ?? "never by the census"}). The API may have retired it; mark it optional or dropped with the reason, and record it in cr-agent-api-docs.`,
        });
    }

    // File once per (endpoint, path) while an item is open.
    for (const f of report.findings) {
      const { rows: open } = await db.query(
        `select 1 from feedback
         where surface = 'recorder' and status = any($3::text[])
           and context->>'endpoint' = $1 and context->>'path' = $2 limit 1`,
        [f.endpoint, f.path, OPEN],
      );
      if (open.length) {
        report.already_open += 1;
        continue;
      }
      if (!owner) continue;
      await db.query(
        `insert into feedback (account_id, surface, category, message, context)
         values ($1, 'recorder', 'data_quality', $2, $3::jsonb)`,
        [
          owner.account_id,
          f.message,
          JSON.stringify({
            endpoint: f.endpoint,
            path: f.path,
            first_seen: now.toISOString(),
            sample_type: f.sample_type,
            seen_in: f.seen_in,
            sampled: f.sampled,
          }),
        ],
      );
      report.filed += 1;
    }
    emitMetrics(`${shapeFindingsEmf(report.findings.length, now.getTime())}\n`);
    return { ...report, ms: Date.now() - started };
  } finally {
    await db.end();
  }
}
