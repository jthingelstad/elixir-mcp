#!/usr/bin/env node
/**
 * Every field the API has ever sent for an endpoint, against the manifest
 * — the COMPLETE sweep, not the nightly census's sample.
 *
 *   AWS_PROFILE=cloud-engineer node infra/scripts/payload-field-audit.mjs [endpoint|all]
 *     [--json <dir>]       also write <dir>/<endpoint>.json, the evidence the
 *                          reference audit reads (.claude/skills/reference-audit)
 *     [--per-entity <n>]   read only each entity's newest n objects (a
 *                          player's profile is archived many times; its
 *                          shape rarely differs between them)
 *
 * The nightly shape census (services/jobs/src/shape-census.mjs) reads
 * twenty archived objects per endpoint per day, newest first. That is a
 * good tripwire for a field the API adds to the battles people are
 * playing right now, and structurally blind to anything rare: twenty
 * recent battlelogs are whatever the busiest recorded players just
 * played, so a boat battle, a duel, a tournament or a CHAOS modifier can
 * go unsampled for a long time. globalRank, modifiers, the duel rounds
 * and arena.rawName all reached a disposition late for that reason.
 *
 * This reads EVERY archived object for the endpoint (payloads/ has no
 * expiration — only an IA transition at 30 days — so the archive is the
 * whole inbound history) and reports, per field path: how many objects
 * and entries carry it, and what the manifest says happens to it. A path
 * with no disposition is a field nobody has decided about; the script
 * exits non-zero when it finds one, so this can gate a release
 * (RELEASING-COLLECTOR.md step 3). With --per-entity it is a sample and
 * says so; a release gate runs without it.
 *
 * --json writes the same sweep as evidence (services/ingest/src/
 * payload-evidence.mjs): per path its counts, JSON types, empties and
 * first and last archive day, and the values of the game-vocabulary paths
 * on its allowlist. Aggregates only: no tag or name of a player or clan
 * leaves the archive, because the reference the evidence feeds is public.
 */

import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { crPathForJob } from "@elixir-mcp/contracts";
import {
  PAYLOAD_KEYS,
  payloadPaths,
} from "../../services/ingest/src/payload-keys.mjs";
import { createEvidence } from "../../services/ingest/src/payload-evidence.mjs";

const USAGE =
  "usage: payload-field-audit.mjs [endpoint|all] [--json <dir>] [--per-entity <n>]";
const argv = process.argv.slice(2);
let target = "player_battlelog";
let jsonDir = null;
let perEntity = null;
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--json") jsonDir = argv[++i];
  else if (a === "--per-entity") perEntity = Number(argv[++i]);
  else if (a.startsWith("--")) {
    console.error(`unknown flag ${a}\n${USAGE}`);
    process.exit(2);
  } else target = a;
}
if (jsonDir === undefined || (perEntity !== null && !(perEntity >= 1))) {
  console.error(USAGE);
  process.exit(2);
}
const endpoints = target === "all" ? Object.keys(PAYLOAD_KEYS) : [target];
for (const e of endpoints)
  if (!PAYLOAD_KEYS[e]) {
    console.error(`no manifest for endpoint ${e}`);
    process.exit(2);
  }

const bucket = process.env.ARCHIVE_BUCKET ?? "elixir-mcp-archive-999153317627";
const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY ?? 48);
const s3 = new S3Client({});

async function listKeys(endpoint) {
  const keys = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `payloads/endpoint=${endpoint}/`,
        ContinuationToken: token,
      }),
    );
    for (const o of page.Contents ?? []) keys.push(o.Key);
    token = page.NextContinuationToken;
  } while (token);
  if (!perEntity) return { keys, total: keys.length };
  // Keys are payloads/endpoint=E/entity=X/dt=YYYY-MM-DD/<stamp>-<hash>, so
  // a lexical sort within an entity is chronological.
  const byEntity = new Map();
  for (const k of keys) {
    const entity = k.split("/")[2];
    if (!byEntity.has(entity)) byEntity.set(entity, []);
    byEntity.get(entity).push(k);
  }
  const kept = [];
  for (const list of byEntity.values())
    kept.push(...list.sort().slice(-perEntity));
  return { keys: kept, total: keys.length, entities: byEntity.size };
}

async function audit(endpoint) {
  const manifest = PAYLOAD_KEYS[endpoint];
  const { keys, total, entities } = await listKeys(endpoint);
  console.error(
    `${endpoint}: ${total.toLocaleString()} archived objects` +
      (perEntity
        ? `, reading the newest ${perEntity} of each of ${entities.toLocaleString()} entities (${keys.length.toLocaleString()})`
        : ""),
  );

  const objectsWith = new Map(); // path -> objects containing it
  const entriesWith = new Map(); // path -> entries containing it
  const typeCount = new Map();
  const evidence = jsonDir ? createEvidence(endpoint) : null;
  let objects = 0;
  let entries = 0;
  let failed = 0;

  const bump = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);

  async function one(key) {
    try {
      const o = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const body = gunzipSync(Buffer.from(await o.Body.transformToByteArray()));
      const payload = JSON.parse(body.toString("utf8"));
      objects += 1;
      evidence?.add(
        payload,
        key.match(/\/dt=(\d{4}-\d{2}-\d{2})\//)?.[1],
        key.split("/")[2],
      );
      for (const p of payloadPaths(payload)) bump(objectsWith, p);
      // Per-entry and per-type, where the payload is a list of typed items.
      const list = Array.isArray(payload) ? payload : null;
      if (!list) return;
      for (const e of list) {
        entries += 1;
        bump(typeCount, e?.type ?? "(untyped)");
        for (const p of payloadPaths([e])) bump(entriesWith, p);
      }
    } catch (err) {
      failed += 1;
      if (failed <= 3) console.error(`  ! ${key}: ${err.message}`);
    }
  }

  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    await Promise.all(keys.slice(i, i + CONCURRENCY).map(one));
    if (i % (CONCURRENCY * 50) === 0)
      console.error(
        `  ${i.toLocaleString()} / ${keys.length.toLocaleString()}`,
      );
  }

  const kind = (p) => {
    const d = manifest[p];
    if (!d) return "UNCATALOGUED";
    if (d.dropped) return "dropped";
    if (d.derived) return "derived";
    return "stored";
  };

  const seen = [...objectsWith.keys()].sort();
  const uncatalogued = seen.filter((p) => kind(p) === "UNCATALOGUED");
  const dropped = seen.filter((p) => kind(p) === "dropped");
  const never = Object.keys(manifest)
    .filter((p) => !objectsWith.has(p))
    .sort();

  console.log(
    `\nendpoint ${endpoint}: ${objects.toLocaleString()} objects read (${failed} failed), ` +
      `${entries.toLocaleString()} entries, ${seen.length} distinct paths` +
      (perEntity ? ` (a sample: newest ${perEntity} per entity)` : ""),
  );
  if (typeCount.size) {
    console.log(`\nentry types (${typeCount.size}):`);
    for (const [t, n] of [...typeCount].sort((a, b) => b[1] - a[1]))
      console.log(`  ${t.padEnd(26)} ${n.toLocaleString()}`);
  }

  console.log(
    `\n*** UNCATALOGUED — no disposition (${uncatalogued.length}) ***`,
  );
  for (const p of uncatalogued)
    console.log(
      `  ${p}  objects ${objectsWith.get(p).toLocaleString()} entries ${(entriesWith.get(p) ?? 0).toLocaleString()}`,
    );

  console.log(`\nDROPPED ON PURPOSE, with volume (${dropped.length}):`);
  for (const p of dropped)
    console.log(
      `  ${p.padEnd(52)} entries ${(entriesWith.get(p) ?? 0).toLocaleString().padStart(9)}  ${manifest[p].dropped}`,
    );

  console.log(`\nmanifest paths never observed (${never.length}):`);
  for (const p of never) console.log(`  ${p}`);

  if (evidence) {
    mkdirSync(jsonDir, { recursive: true });
    const file = path.join(jsonDir, `${endpoint}.json`);
    const apiPath = decodeURIComponent(
      crPathForJob({ endpoint, entity_key: "{key}" }) ?? "",
    );
    writeFileSync(
      file,
      JSON.stringify(
        evidence.toJSON({
          api_path: apiPath.split("?")[0],
          generated_at: new Date().toISOString(),
          archived_objects: total,
          sample: perEntity ? { newest_per_entity: perEntity } : null,
          failed,
        }),
        null,
        1,
      ) + "\n",
    );
    console.error(`  evidence -> ${file}`);
  }
  return uncatalogued.length;
}

let uncataloguedTotal = 0;
for (const endpoint of endpoints) uncataloguedTotal += await audit(endpoint);

if (uncataloguedTotal > 0) {
  console.error(
    `\nFAIL: ${uncataloguedTotal} field path(s) arrive with no disposition.`,
  );
  process.exit(1);
}
console.error("\nOK: every observed field path has a disposition.");
