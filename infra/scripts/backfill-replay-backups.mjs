#!/usr/bin/env node
/**
 * Replay elixir-bot's PRE-v5.1 raw history into elixir-mcp — the second
 * backfill (NOTES 2026-09-15). The first (backfill-replay.mjs, 2026-09-04)
 * read the live elixir-v51.db, whose raw_api_payloads is a 60-day buffer,
 * so it reached back only to ~2026-07-08. Everything older survives only
 * in the rolling backups (~/elixir-backups/*.db.gz): each nightly froze
 * that buffer as it stood on its own date, and their UNION reaches back
 * to the bot's first poll on 2026-03-07.
 *
 * Sources are the DECOMPRESSED backup files, opened strictly read-only
 * (?mode=ro&immutable=1). Payloads are deduplicated across files by
 * (endpoint, entity_key, payload_hash), keeping the earliest fetched_at,
 * ordered chronologically, and fed in batches to the migrate Lambda's
 * {replay} op — the real admission pipeline, original fetch times,
 * provenance under the backfill-elixir-bot gateway.
 *
 * Scope: player_battlelog, player, currentriverrace, riverracelog (stored
 * under the v4 label clan_war_log — relabelled here). NEVER 'clan': the
 * membership state machine only runs forward. Overlap with the first
 * import is harmless — same gateway + endpoint + entity + fetched_at is a
 * receipt conflict, reported as `duplicate`, no projection.
 *
 *   AWS_PROFILE=jamie node infra/scripts/backfill-replay-backups.mjs --dry-run <db...>
 *   AWS_PROFILE=jamie node infra/scripts/backfill-replay-backups.mjs --limit 200 <db...>
 *   AWS_PROFILE=jamie node infra/scripts/backfill-replay-backups.mjs <db...>
 *
 *   --local postgres://...   rehearse in-process against a scratch DB
 *                            (ops-record replay(), no Lambda, no S3)
 *   --cutoff 2026-07-15      only payloads fetched before this instant
 *   --gap <v4 backup .db>    ALSO replay the 2026-05-04..05-14 raw gap
 *                            from v4 member_battle_facts.raw_json (see
 *                            gapMessages below)
 *
 * Resumable: progress (last fetched_at+hash) in .backfill-backups-progress.json.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const ENDPOINTS = {
  player_battlelog: "player_battlelog",
  player: "player",
  currentriverrace: "currentriverrace",
  riverracelog: "riverracelog",
  clan_war_log: "riverracelog", // v4 label for the same CR endpoint
};
const PROGRESS_FILE = new URL(
  "../../.backfill-backups-progress.json",
  import.meta.url,
);
const PERF_FILE = new URL("../../.backfill-backups-perf.json", import.meta.url);
const LAMBDA_BUDGET_MS = 300_000; // migrate Lambda timeout
const GAP_FROM = "20260504T000000.000Z";
const GAP_TO = "20260515T000000.000Z";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : dflt;
};
const dryRun = flag("--dry-run");
const limit = Number(opt("--limit", Infinity));
const localUrl = opt("--local", null);
const cutoff = opt("--cutoff", "2026-07-15T00:00:00Z");
const gapDb = opt("--gap", null);
let batchMax = Number(opt("--batch", 60));
const sources = argv.filter(
  (a, i) =>
    a.endsWith(".db") &&
    !["--local", "--cutoff", "--limit", "--batch", "--gap"].includes(
      argv[i - 1],
    ),
);
if (sources.length === 0 && !gapDb) {
  console.error("usage: backfill-replay-backups.mjs [flags] <backup.db ...>");
  process.exit(2);
}

// node:sqlite, in-process: the sqlite3 CLI's -json mode spends ~1s
// escaping a 200 KB battlelog, which made a spawn-per-payload loop the
// bottleneck. immutable=1 on the URI: the archive is never written.
const handles = new Map();
function open(file) {
  let h = handles.get(file);
  if (!h) {
    h = new DatabaseSync(`file:${file}?mode=ro&immutable=1`, {
      readOnly: true,
    });
    handles.set(file, h);
  }
  return h;
}
function q(file, sql, params = []) {
  return open(file)
    .prepare(sql)
    .all(...params);
}

const isoZ = (s) => (s.endsWith("Z") ? s : `${s}Z`);

// 1. Index: union of every replayable payload across the sources ----------
const index = new Map(); // key -> {endpoint, entity_key, fetched_at, file, payload_id}
const epList = Object.keys(ENDPOINTS)
  .map((e) => `'${e}'`)
  .join(",");
for (const file of sources) {
  const rows = q(
    file,
    `select payload_id, endpoint, entity_key, fetched_at, payload_hash
     from raw_api_payloads
     where endpoint in (${epList}) and fetched_at < '${cutoff}'`,
  );
  let added = 0;
  for (const r of rows) {
    const endpoint = ENDPOINTS[r.endpoint];
    const fetched_at = isoZ(r.fetched_at);
    const key = `${endpoint}|${r.entity_key}|${r.payload_hash}`;
    const have = index.get(key);
    if (!have || fetched_at < have.fetched_at) {
      index.set(key, {
        key,
        endpoint,
        entity_key: r.entity_key,
        fetched_at,
        file,
        payload_id: r.payload_id,
      });
      if (!have) added += 1;
    }
  }
  console.log(`${file}: ${rows.length} rows, ${added} new to the union`);
}

// 2. The May 4-14 raw gap (optional): no backup exists between 05-03 and
// 05-31 and retention was 14 days, but v4 member_battle_facts kept each
// battle's raw API entry. Regroup a player's gap battles into log-shaped
// arrays (newest first, <=25 per array, like a real battlelog read) and
// stamp fetched_at one hour after the newest battle — the bot did read
// these logs then; only the raw copies were purged.
function gapMessages() {
  if (!gapDb) return [];
  const rows = q(
    gapDb,
    `select m.player_tag, f.battle_time, f.raw_json
     from member_battle_facts f join members m on m.member_id = f.member_id
     where f.battle_time >= '${GAP_FROM}' and f.battle_time < '${GAP_TO}'
       and f.raw_json is not null
     order by m.player_tag, f.battle_time desc`,
  );
  const byPlayer = new Map();
  for (const r of rows) {
    let entry;
    try {
      entry = JSON.parse(r.raw_json);
    } catch {
      continue;
    }
    if (!entry?.battleTime || !Array.isArray(entry.team)) continue;
    const tag = r.player_tag.replace(/^#/, "");
    (byPlayer.get(tag) ?? byPlayer.set(tag, []).get(tag)).push(entry);
  }
  const out = [];
  for (const [tag, entries] of byPlayer) {
    for (let i = 0; i < entries.length; i += 25) {
      const chunk = entries.slice(i, i + 25);
      // CR battleTime 20260504T123456.000Z -> ISO
      const bt = chunk[0].battleTime;
      const newest = new Date(
        `${bt.slice(0, 4)}-${bt.slice(4, 6)}-${bt.slice(6, 8)}T${bt.slice(9, 11)}:${bt.slice(11, 13)}:${bt.slice(13, 15)}Z`,
      );
      const fetched_at = new Date(newest.getTime() + 3600_000).toISOString();
      const json = JSON.stringify(chunk);
      out.push({
        key: `gap|${tag}|${createHash("sha256").update(json).digest("hex")}`,
        endpoint: "player_battlelog",
        entity_key: tag,
        fetched_at,
        json,
        gap: true,
      });
    }
  }
  console.log(
    `gap: ${rows.length} battle facts -> ${out.length} log-shaped payloads for ${byPlayer.size} players`,
  );
  return out;
}

const plan = [...index.values(), ...gapMessages()].sort(
  (a, b) =>
    a.fetched_at.localeCompare(b.fetched_at) || a.key.localeCompare(b.key),
);
const byEp = {};
for (const p of plan) byEp[p.endpoint] = (byEp[p.endpoint] ?? 0) + 1;
console.log(
  `plan: ${plan.length} payloads ${plan[0]?.fetched_at} -> ${plan.at(-1)?.fetched_at}`,
  byEp,
);

let cursor = { fetched_at: "", key: "" };
if (existsSync(PROGRESS_FILE) && !localUrl) {
  cursor = JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
  console.log(`resuming after ${cursor.fetched_at} (${cursor.key})`);
}
const after = (p) =>
  p.fetched_at > cursor.fetched_at ||
  (p.fetched_at === cursor.fetched_at && p.key > cursor.key);
const pending = plan.filter(after);
console.log(`${pending.length} pending`);
if (dryRun) {
  console.log(
    "first five:",
    pending.slice(0, 5).map(({ json: _json, ...r }) => r),
  );
  process.exit(0);
}

// 3. Send ------------------------------------------------------------------
function loadJson(p) {
  if (p.json) return p.json;
  const [row] = q(
    p.file,
    "select payload_json from raw_api_payloads where payload_id = ?",
    [p.payload_id],
  );
  return row.payload_json;
}

let invoke;
if (localUrl) {
  const { replay } = await import("../../services/migrate/src/ops-record.mjs");
  invoke = async (messages) => replay(localUrl, { messages });
} else {
  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  invoke = async (messages) => {
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: "elixir-mcp-migrate",
        Payload: Buffer.from(JSON.stringify({ replay: { messages } })),
      }),
    );
    const body = JSON.parse(Buffer.from(res.Payload).toString());
    if (res.FunctionError || !body?.tally) {
      throw new Error(
        `replay invoke failed: ${res.FunctionError} ${JSON.stringify(body).slice(0, 500)}`,
      );
    }
    return body;
  };
}

let sent = 0;
const tally = {};
const perf =
  existsSync(PERF_FILE) && !localUrl
    ? JSON.parse(readFileSync(PERF_FILE, "utf8"))
    : {};
const t0 = Date.now();
let i = 0;
while (i < pending.length && sent < limit) {
  const want = Math.min(batchMax, limit - sent);
  const rows = [];
  let budget = 4_500_000; // invoke payload cap is 6 MB
  while (rows.length < want && i < pending.length) {
    const p = pending[i];
    const gz = gzipSync(Buffer.from(loadJson(p))).toString("base64");
    if (budget - gz.length < 0 && rows.length > 0) break;
    budget -= gz.length;
    rows.push({ ...p, gz });
    i += 1;
  }
  const messages = rows.map((r) => ({
    v: 1,
    job: { endpoint: r.endpoint, entity_key: r.entity_key, lane: "bulk" },
    gateway_id: "backfill", // stamped by the replay op (backfill-elixir-bot)
    fetched_at: r.fetched_at,
    status: "ok",
    body_gzip_b64: r.gz,
  }));
  const tb = Date.now();
  let body;
  try {
    body = await invoke(messages);
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
  const batchMs = Date.now() - tb;
  for (const [k, v] of Object.entries(body.tally))
    tally[k] = (tally[k] ?? 0) + v;
  for (const [ep, ph] of Object.entries(body.perf ?? {})) {
    const agg = (perf[ep] ??= {});
    for (const [k, v] of Object.entries(ph)) agg[k] = (agg[k] ?? 0) + v;
  }
  sent += rows.length;
  const last = rows.at(-1);
  cursor = { fetched_at: last.fetched_at, key: last.key };
  if (!localUrl) {
    writeFileSync(PROGRESS_FILE, JSON.stringify(cursor));
    writeFileSync(PERF_FILE, JSON.stringify(perf));
  }
  // Keep each invoke well inside the Lambda timeout: shrink on a slow
  // batch, grow back slowly on a fast one.
  if (batchMs > LAMBDA_BUDGET_MS * 0.5)
    batchMax = Math.max(10, Math.floor(batchMax / 2));
  else if (batchMs < LAMBDA_BUDGET_MS * 0.15 && batchMax < 120) batchMax += 10;
  const elapsed = (Date.now() - t0) / 1000;
  const rate = sent / elapsed;
  const eta = Math.round((pending.length - sent) / rate / 60);
  console.log(
    `${sent}/${pending.length} through ${last.fetched_at}  batch=${rows.length} in ${(batchMs / 1000).toFixed(1)}s  next=${batchMax}  ${rate.toFixed(2)}/s  eta ${eta}m  tally=${JSON.stringify(tally)}`,
  );
}
console.log(`done. sent ${sent}, tally ${JSON.stringify(tally)}`);
