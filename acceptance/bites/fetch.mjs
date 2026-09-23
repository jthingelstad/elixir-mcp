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
 * version at the top, and the feedback id when given. The response is
 * recorded public game data, the same class as fixtures/; nothing
 * private rides a tool body.
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
const response = { ...capture.response };
if (response.meta) response.meta = { contract_version: contract };
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
