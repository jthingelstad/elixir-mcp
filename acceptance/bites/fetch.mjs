#!/usr/bin/env node
/**
 * Pull one captured call from the archive bucket into acceptance/bites/
 * so a rule can be proved against it forever (the bucket expires calls/
 * after 90 days; the proof must not).
 *
 *   AWS_PROFILE=cloud-engineer node acceptance/bites/fetch.mjs <YYYY-MM-DD> <request_id prefix> <name> [feedback id]
 *
 * Writes bites/<name>.json: the request, the response with its meta
 * reduced to contract_version (no request id, no quota), the contract
 * version at the top, and the feedback id when given. This repo is
 * public, and a tool body is NOT all public game data: since 9.2.0 a
 * timeline carries attested facts, some for a clan's members or leaders
 * only, and the reader's own account items. Every item in the
 * `attested` or `account` section is reduced to its kind, section,
 * instant and subject (private.mjs); bites.test.mjs fails on a committed
 * bite that holds more. The private S3 capture stays whole.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { stubPrivate } from "./private.mjs";

const [date, prefix, name, feedback] = process.argv.slice(2);
if (!date || !prefix || !name) {
  console.error(
    "usage: fetch.mjs <YYYY-MM-DD> <request_id prefix> <name> [feedback id]",
  );
  process.exit(2);
}
const bucket = process.env.ARCHIVE_BUCKET ?? "elixir-mcp-archive-999153317627";
const s3 = new S3Client({});
const listed = await s3.send(
  new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `calls/dt=${date}/request_id=${prefix}`,
  }),
);
const keys = (listed.Contents ?? []).map((o) => o.Key);
if (keys.length !== 1) {
  console.error(
    `${keys.length} captures match ${prefix} on ${date}: ${keys.join(", ")}`,
  );
  process.exit(1);
}
const obj = await s3.send(
  new GetObjectCommand({ Bucket: bucket, Key: keys[0] }),
);
const raw = gunzipSync(Buffer.from(await obj.Body.transformToByteArray()));
const capture = JSON.parse(raw.toString("utf8"));
const contract = capture.response?.meta?.contract_version ?? null;
const response = stubPrivate(capture.response ?? {});
// meta keeps the contract version and the poll times a case may compare
// against (source_polls: public freshness, Gym 91.1); never the request
// id or the caller's quota.
if (response.meta)
  response.meta = {
    contract_version: contract,
    ...(response.meta.source_polls
      ? { source_polls: response.meta.source_polls }
      : {}),
  };
const out = {
  ...(feedback ? { feedback: Number(feedback) } : {}),
  contract_version: contract,
  captured_at: capture.captured_at,
  request: capture.request,
  response,
  timings: capture.timings ?? null,
};
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, `${name}.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(
  `${file}: ${capture.request.tool} on ${contract}, ${raw.length} bytes`,
);
