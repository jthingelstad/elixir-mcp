#!/usr/bin/env node
/**
 * Replay elixir-bot's raw_api_payloads archive into elixir-mcp — the
 * stage-1/2 backfill (NOTES 2026-09-04). Reads the archive STRICTLY
 * read-only (sqlite ?mode=ro), orders payloads chronologically, and
 * feeds batches to the migrate Lambda's {replay} op, which runs each
 * through the real admission pipeline in order.
 *
 * Scope: player_battlelog, player, currentriverrace, riverracelog.
 * NEVER 'clan' — the membership state machine only runs forward.
 * Cutoff: payloads fetched before elixir-mcp's own recording began;
 * everything after is already first-party.
 *
 *   AWS_PROFILE=jamie node infra/scripts/backfill-replay.mjs --dry-run
 *   AWS_PROFILE=jamie node infra/scripts/backfill-replay.mjs --limit 50
 *   AWS_PROFILE=jamie node infra/scripts/backfill-replay.mjs
 *
 * Resumable: progress (last fetched_at+payload_id) in .backfill-progress.json.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const ARCHIVE = `${process.env.HOME}/Projects/elixir-bot/elixir-v51.db`;
const ARCHIVE_URI = `file:${ARCHIVE}?mode=ro`;
const CUTOFF = "2026-09-03T18:00";
const ENDPOINTS =
  "('player_battlelog','player','currentriverrace','riverracelog')";
const BATCH = 80;
const PROGRESS_FILE = new URL("../../.backfill-progress.json", import.meta.url);

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

function q(sql) {
  const out = execFileSync("sqlite3", ["-json", ARCHIVE_URI, sql], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString();
  return out.trim() ? JSON.parse(out) : [];
}

const [{ total }] = q(
  `select count(*) as total from raw_api_payloads
   where endpoint in ${ENDPOINTS} and fetched_at < '${CUTOFF}'`,
);
console.log(`archive: ${total} replayable payloads before ${CUTOFF}`);

let cursor = { fetched_at: "", payload_id: 0 };
if (existsSync(PROGRESS_FILE)) {
  cursor = JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
  console.log(`resuming after ${cursor.fetched_at} (#${cursor.payload_id})`);
}

if (dryRun) {
  const sample = q(
    `select endpoint, entity_key, fetched_at, length(payload_json) as bytes
     from raw_api_payloads
     where endpoint in ${ENDPOINTS} and fetched_at < '${CUTOFF}'
     order by fetched_at, payload_id limit 5`,
  );
  console.log("first batch preview:", sample);
  process.exit(0);
}

const lambda = new LambdaClient({});
let sent = 0;
const tally = {};

while (sent < limit) {
  const rows = q(
    `select payload_id, endpoint, entity_key, fetched_at, payload_json
     from raw_api_payloads
     where endpoint in ${ENDPOINTS} and fetched_at < '${CUTOFF}'
       and (fetched_at > '${cursor.fetched_at}'
            or (fetched_at = '${cursor.fetched_at}' and payload_id > ${cursor.payload_id}))
     order by fetched_at, payload_id
     limit ${Math.min(BATCH, limit - sent)}`,
  );
  if (rows.length === 0) break;

  // Invoke payloads cap at 6MB: trim the batch if gzipped bodies run big.
  let budget = 4_500_000;
  const keep = [];
  for (const r of rows) {
    const gz = gzipSync(Buffer.from(r.payload_json)).toString("base64");
    if (budget - gz.length < 0 && keep.length > 0) break;
    budget -= gz.length;
    keep.push({ ...r, gz });
  }
  rows.length = 0;
  rows.push(...keep);

  const messages = rows.map((r) => ({
    v: 1,
    job: { endpoint: r.endpoint, entity_key: r.entity_key, lane: "bulk" },
    // gateway_id is stamped by the replay op (backfill-elixir-bot).
    gateway_id: "backfill",
    // Archive timestamps are sometimes missing the Z; fetched_at is UTC.
    fetched_at: r.fetched_at.endsWith("Z") ? r.fetched_at : `${r.fetched_at}Z`,
    status: "ok",
    body_gzip_b64: r.gz,
  }));

  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: "elixir-mcp-migrate",
      Payload: Buffer.from(JSON.stringify({ replay: { messages } })),
    }),
  );
  const body = JSON.parse(Buffer.from(res.Payload).toString());
  if (res.FunctionError || !body?.tally) {
    console.error("replay invoke failed:", res.FunctionError, body);
    process.exit(1);
  }
  for (const [k, v] of Object.entries(body.tally))
    tally[k] = (tally[k] ?? 0) + v;
  sent += rows.length;
  const last = rows[rows.length - 1];
  cursor = { fetched_at: last.fetched_at, payload_id: last.payload_id };
  writeFileSync(PROGRESS_FILE, JSON.stringify(cursor));
  console.log(
    `${sent} sent (through ${last.fetched_at})  tally=${JSON.stringify(tally)}`,
  );
}

console.log(`done. total sent: ${sent}, tally: ${JSON.stringify(tally)}`);
