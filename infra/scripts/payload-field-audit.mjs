#!/usr/bin/env node
/**
 * Every field the API has ever sent for an endpoint, against the manifest
 * — the COMPLETE sweep, not the nightly census's sample.
 *
 *   AWS_PROFILE=cloud-engineer node infra/scripts/payload-field-audit.mjs [endpoint]
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
 * exits non-zero when it finds one, so this can gate a release.
 */

import { gunzipSync } from "node:zlib";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import {
  PAYLOAD_KEYS,
  payloadPaths,
} from "../../services/ingest/src/payload-keys.mjs";

const endpoint = process.argv[2] ?? "player_battlelog";
const bucket = process.env.ARCHIVE_BUCKET ?? "elixir-mcp-archive-999153317627";
const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY ?? 48);
const manifest = PAYLOAD_KEYS[endpoint];
if (!manifest) {
  console.error(`no manifest for endpoint ${endpoint}`);
  process.exit(2);
}

const s3 = new S3Client({});
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
console.error(`${keys.length.toLocaleString()} archived objects`);

const objectsWith = new Map(); // path -> objects containing it
const entriesWith = new Map(); // path -> entries containing it
const typeCount = new Map();
const pathsByType = new Map(); // battle type -> Set(path)
let objects = 0;
let entries = 0;
let failed = 0;

const bump = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);

async function one(key) {
  try {
    const o = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = gunzipSync(Buffer.from(await o.Body.transformToByteArray()));
    const payload = JSON.parse(body.toString("utf8"));
    objects += 1;
    for (const p of payloadPaths(payload)) bump(objectsWith, p);
    // Per-entry and per-type, where the payload is a list of typed items.
    const list = Array.isArray(payload) ? payload : null;
    if (!list) return;
    for (const e of list) {
      entries += 1;
      const t = e?.type ?? "(untyped)";
      bump(typeCount, t);
      if (!pathsByType.has(t)) pathsByType.set(t, new Set());
      const set = pathsByType.get(t);
      for (const p of payloadPaths([e])) {
        bump(entriesWith, p);
        set.add(p);
      }
    }
  } catch (err) {
    failed += 1;
    if (failed <= 3) console.error(`  ! ${key}: ${err.message}`);
  }
}

for (let i = 0; i < keys.length; i += CONCURRENCY) {
  await Promise.all(keys.slice(i, i + CONCURRENCY).map(one));
  if (i % (CONCURRENCY * 50) === 0)
    console.error(`  ${i.toLocaleString()} / ${keys.length.toLocaleString()}`);
}

const kind = (path) => {
  const d = manifest[path];
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
    `${entries.toLocaleString()} entries, ${seen.length} distinct paths`,
);
console.log(`\nentry types (${typeCount.size}):`);
for (const [t, n] of [...typeCount].sort((a, b) => b[1] - a[1]))
  console.log(`  ${t.padEnd(26)} ${n.toLocaleString()}`);

console.log(`\n*** UNCATALOGUED — no disposition (${uncatalogued.length}) ***`);
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

if (uncatalogued.length > 0) {
  console.error(
    `\nFAIL: ${uncatalogued.length} field path(s) arrive with no disposition.`,
  );
  process.exit(1);
}
console.error("\nOK: every observed field path has a disposition.");
