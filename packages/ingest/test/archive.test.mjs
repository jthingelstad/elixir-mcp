/**
 * The payload archive is write-once (review 2026-09-27 §2.7): every put
 * asks S3 not to replace an existing key, and a 412 is "already
 * archived", which a retried submit of the same fetch produces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeArchive } from "../src/handler.mjs";
import { ARCHIVED_ENDPOINTS } from "../src/pipeline.mjs";

function fakeS3(answer) {
  const sent = [];
  return {
    sent,
    async send(command) {
      sent.push(command.input);
      return answer(command.input);
    },
  };
}

const s3Error = (name, status) =>
  Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode: status },
  });

test("no bucket, no archive", () => {
  assert.equal(makeArchive(""), null);
  assert.equal(makeArchive(undefined), null);
});

test("every put is conditional on the key not existing", async () => {
  const s3 = fakeS3(() => ({}));
  const archive = makeArchive("bucket", { s3 });
  await archive.put("payloads/endpoint=player/k.json.gz", Buffer.from("x"));
  assert.equal(s3.sent.length, 1);
  assert.equal(s3.sent[0].IfNoneMatch, "*");
  assert.equal(s3.sent[0].Bucket, "bucket");
  assert.equal(s3.sent[0].Key, "payloads/endpoint=player/k.json.gz");
  assert.equal(s3.sent[0].ContentEncoding, "gzip");
});

test("a 412 is already archived, not a failure", async () => {
  const archive = makeArchive("bucket", {
    s3: fakeS3(() => {
      throw s3Error("PreconditionFailed", 412);
    }),
  });
  await archive.put("payloads/k.json.gz", Buffer.from("x"));
});

test("any other S3 error still fails admission", async () => {
  for (const err of [
    s3Error("AccessDenied", 403),
    s3Error("ConditionalRequestConflict", 409),
    s3Error("InternalError", 500),
  ]) {
    const archive = makeArchive("bucket", {
      s3: fakeS3(() => {
        throw err;
      }),
    });
    await assert.rejects(
      archive.put("payloads/k.json.gz", Buffer.from("x")),
      (e) => e === err,
    );
  }
});

// The Glue table is how Athena reads this archive (review 2026-09-27
// §7.7). Its partition projection is an ENUM of endpoints, so an
// endpoint missing from it is invisible to every query: on 2026-09-27 it
// listed 6 of the 15 the archive holds. Every projector archives what it
// admits, under payloads/endpoint=<its key>/, so the enum is pinned to
// the projector keys.
test("the Glue table's endpoint enum is exactly the archived endpoints", async () => {
  const template = await readFile(
    new URL("../../../infra/template.yaml", import.meta.url),
    "utf8",
  );
  const line = /projection\.endpoint\.values: (.+)$/m.exec(template);
  assert.ok(line, "the Glue table declares its endpoint enum");
  assert.deepEqual(
    line[1].trim().split(",").sort(),
    [...ARCHIVED_ENDPOINTS].sort(),
  );
  assert.equal(ARCHIVED_ENDPOINTS.length, 8);
});
