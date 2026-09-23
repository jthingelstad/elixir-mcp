#!/usr/bin/env node
/**
 * Replay elixir-bot's PROFILE payloads for the archive's 51-day hole
 * (time-series review 6.1 step 1; Phase 3, 2026-09-18): the bot's
 * raw_api_payloads holds 5,488 `player` payloads for 2026-07-15 ->
 * 09-03 that nobody replayed (the 09-04 import took battle logs, the
 * 09-15 pass rosters, war state, events and cards). Real API payloads
 * through the migrate Lambda's {replay} op, in fetch order, under the
 * backfill-elixir-bot gateway, with moments: false - the full profile
 * projector writes the rows (snapshots, badges, cards, progress, the
 * PoL final, the frozen counters) and never a moment. Runs BEFORE the
 * series import, so the import sees those days as overlapping.
 *
 *   AWS_PROFILE=cloud-engineer node infra/scripts/backfill-replay-profiles.mjs --dry-run
 *   AWS_PROFILE=cloud-engineer node infra/scripts/backfill-replay-profiles.mjs
 *
 * The bot's database is opened strictly read-only. Resumable: progress
 * in .backfill-profiles-progress.json.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const ARCHIVE = new URL("../../../elixir-bot/elixir-v51.db", import.meta.url)
  .pathname;
const ARCHIVE_URI = `file:${ARCHIVE}?mode=ro`;
const FROM = "2026-07-15";
const TO = "2026-09-04";
const BATCH = 60;
const PROGRESS_FILE = new URL(
  "../../.backfill-profiles-progress.json",
  import.meta.url,
);
const dryRun = process.argv.includes("--dry-run");

function q(sql) {
  const out = execFileSync("sqlite3", ["-json", ARCHIVE_URI, sql], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString();
  return out.trim() ? JSON.parse(out) : [];
}

const where = `endpoint = 'player' and fetched_at >= '${FROM}' and fetched_at < '${TO}'`;
const [{ total, players, first, last }] = q(
  `select count(*) as total, count(distinct entity_key) as players,
          min(fetched_at) as first, max(fetched_at) as last
   from raw_api_payloads where ${where}`,
);
console.log(
  `archive: ${total} profile payloads for ${players} players, ${first} -> ${last}`,
);
if (dryRun) process.exit(0);

let cursor = { fetched_at: "", payload_id: 0 };
if (existsSync(PROGRESS_FILE)) {
  cursor = JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
  console.log(`resuming after ${cursor.fetched_at} (#${cursor.payload_id})`);
}

const lambda = new LambdaClient({});
const tally = {};
let sent = 0;
const started = Date.now();
for (;;) {
  const rows = q(
    `select payload_id, endpoint, entity_key, fetched_at, payload_json
     from raw_api_payloads
     where ${where}
       and (fetched_at > '${cursor.fetched_at}'
            or (fetched_at = '${cursor.fetched_at}' and payload_id > ${cursor.payload_id}))
     order by fetched_at, payload_id limit ${BATCH}`,
  );
  if (rows.length === 0) break;
  const messages = rows.map((r) => ({
    v: 1,
    job: { endpoint: r.endpoint, entity_key: r.entity_key, lane: "bulk" },
    gateway_id: "backfill",
    fetched_at: r.fetched_at.endsWith("Z") ? r.fetched_at : `${r.fetched_at}Z`,
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(r.payload_json)).toString("base64"),
  }));
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: "elixir-mcp-migrate",
      Payload: Buffer.from(
        JSON.stringify({ replay: { messages, moments: false } }),
      ),
    }),
  );
  const body = JSON.parse(Buffer.from(res.Payload).toString());
  if (res.FunctionError || !body?.tally) {
    console.error(
      "replay invoke failed:",
      res.FunctionError,
      JSON.stringify(body).slice(0, 600),
    );
    process.exit(1);
  }
  for (const [k, v] of Object.entries(body.tally))
    tally[k] = (tally[k] ?? 0) + v;
  sent += rows.length;
  const lastRow = rows[rows.length - 1];
  cursor = { fetched_at: lastRow.fetched_at, payload_id: lastRow.payload_id };
  writeFileSync(PROGRESS_FILE, JSON.stringify(cursor));
  const perf = body.perf?.player;
  console.log(
    `${new Date().toISOString()} sent ${sent}/${total} through ${lastRow.fetched_at} tally ${JSON.stringify(body.tally)}` +
      (perf ? ` ${Math.round(perf.total_ms / perf.count)} ms/payload` : ""),
  );
}
console.log(
  `done: ${sent} payloads, ${JSON.stringify(tally)}, ${Math.round((Date.now() - started) / 1000)} s`,
);
