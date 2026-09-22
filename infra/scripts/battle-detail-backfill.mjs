#!/usr/bin/env node
/**
 * Land duel round results and global_rank on battles recorded before
 * migration 0151, from the S3 payload archive.
 *
 *   AWS_PROFILE=jamie node infra/scripts/battle-detail-backfill.mjs --dry-run
 *   AWS_PROFILE=jamie node infra/scripts/battle-detail-backfill.mjs
 *
 * Postgres caches a payload for two hours, so the archive is the only
 * copy; the sweep is local because reading 72k objects is I/O the Lambda
 * should not sit through. Each entry goes through the SAME
 * canonicalizeBattle the live pipeline uses, so a battle_id computed
 * here is the battle_id already in the record - no parallel parsing.
 * Batches post to the migrate Lambda's {battle_detail_backfill}, which
 * joins to battle_participant and skips anything this record never held.
 *
 * Idempotent and resumable: progress is the last S3 key handled, in
 * .battle-detail-progress.json. battle_participant_card.used is NOT
 * backfilled - it is ~700k rows for a flag nothing reads yet, and it
 * fills forward from 0151.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { canonicalizeBattle } from "../../services/ingest/src/battles.mjs";

const bucket = process.env.ARCHIVE_BUCKET ?? "elixir-mcp-archive-999153317627";
const FUNCTION = process.env.MIGRATE_FUNCTION ?? "elixir-mcp-migrate";
const READ_CONCURRENCY = Number(process.env.BACKFILL_READ_CONCURRENCY ?? 48);
const POST_EVERY = Number(process.env.BACKFILL_BATCH ?? 4000);
const PROGRESS = new URL("../../.battle-detail-progress.json", import.meta.url);
const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const s3 = new S3Client({});
const lambda = new LambdaClient({});
const progress = existsSync(PROGRESS)
  ? JSON.parse(readFileSync(PROGRESS, "utf8"))
  : { lastKey: null, roundRows: 0, rankRows: 0, objects: 0 };

const keys = [];
let token;
do {
  const page = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: "payloads/endpoint=player_battlelog/",
      ContinuationToken: token,
    }),
  );
  for (const o of page.Contents ?? []) keys.push(o.Key);
  token = page.NextContinuationToken;
} while (token);
keys.sort();
const start = progress.lastKey
  ? keys.findIndex((k) => k > progress.lastKey)
  : 0;
const work = keys.slice(
  start < 0 ? keys.length : start,
  start < 0 ? keys.length : start + (limit === Infinity ? keys.length : limit),
);
console.error(
  `${keys.length.toLocaleString()} archived objects, ${work.length.toLocaleString()} to do` +
    (progress.lastKey ? ` (resuming after ${progress.lastKey})` : ""),
);

let rounds = [];
let ranks = [];
let objects = 0;
let seenRound = 0;
let seenRank = 0;

async function post(final = false) {
  if (rounds.length === 0 && ranks.length === 0) return;
  if (dryRun) {
    rounds = [];
    ranks = [];
    return;
  }
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: FUNCTION,
      Payload: Buffer.from(
        JSON.stringify({ battle_detail_backfill: { rounds, ranks } }),
      ),
    }),
  );
  const out = JSON.parse(Buffer.from(res.Payload).toString("utf8"));
  if (out?.errorMessage) throw new Error(out.errorMessage);
  progress.roundRows += out.round_rows ?? 0;
  progress.rankRows += out.rank_rows ?? 0;
  rounds = [];
  ranks = [];
  if (final) console.error("  final batch posted");
}

async function one(key) {
  try {
    const o = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const payload = JSON.parse(
      gunzipSync(Buffer.from(await o.Body.transformToByteArray())).toString(
        "utf8",
      ),
    );
    if (!Array.isArray(payload)) return;
    objects += 1;
    for (const entry of payload) {
      let canonical;
      try {
        canonical = canonicalizeBattle(entry);
      } catch {
        continue; // a payload is not our invariant
      }
      const { battle, participants } = canonical;
      for (const p of participants) {
        for (const r of p.rounds ?? []) {
          seenRound += 1;
          rounds.push({
            battle_id: battle.battle_id,
            player_tag: p.player_tag,
            round: r.round,
            crowns: r.crowns,
            king_tower_hp: r.king_tower_hp,
            princess_tower_hp_1: r.princess_tower_hp_1,
            princess_tower_hp_2: r.princess_tower_hp_2,
            elixir_leaked: r.elixir_leaked,
          });
        }
        if (p.global_rank !== null && p.global_rank !== undefined) {
          seenRank += 1;
          ranks.push({
            battle_id: battle.battle_id,
            player_tag: p.player_tag,
            global_rank: p.global_rank,
          });
        }
      }
    }
  } catch (err) {
    console.error(`  ! ${key}: ${err.message}`);
  }
}

for (let i = 0; i < work.length; i += READ_CONCURRENCY) {
  const slice = work.slice(i, i + READ_CONCURRENCY);
  await Promise.all(slice.map(one));
  progress.lastKey = slice[slice.length - 1];
  progress.objects = (progress.objects ?? 0) + slice.length;
  if (rounds.length + ranks.length >= POST_EVERY) {
    await post();
    if (!dryRun) writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
  }
  if (i % (READ_CONCURRENCY * 100) === 0)
    console.error(
      `  ${i.toLocaleString()}/${work.length.toLocaleString()} objects · rounds seen ${seenRound.toLocaleString()} · ranks seen ${seenRank.toLocaleString()} · written r${progress.roundRows.toLocaleString()}/k${progress.rankRows.toLocaleString()}`,
    );
}
await post(true);
if (!dryRun) writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
console.error(
  `\n${dryRun ? "DRY RUN " : ""}objects ${objects.toLocaleString()} · round rows seen ${seenRound.toLocaleString()} written ${progress.roundRows.toLocaleString()} · rank rows seen ${seenRank.toLocaleString()} written ${progress.rankRows.toLocaleString()}`,
);
