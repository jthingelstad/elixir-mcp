import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutbox, countStuck } from "../src/outbox.mjs";

test("outbox: one JSON object per message under its lane; no bucket, no outbox", async () => {
  const puts = [];
  const s3 = { send: async (cmd) => puts.push(cmd.input) };
  const send = makeOutbox("outbox-bucket", s3);
  await send("email", { v: 1, kind: "welcome", to: "a@b.com" });
  assert.equal(puts.length, 1);
  assert.equal(puts[0].Bucket, "outbox-bucket");
  assert.match(puts[0].Key, /^email\/[0-9a-f-]{36}\.json$/);
  assert.deepEqual(JSON.parse(puts[0].Body), {
    v: 1,
    kind: "welcome",
    to: "a@b.com",
  });
  assert.equal(makeOutbox(undefined, s3), null);
});

test("dead letters: objects past their lane's last retry, across pages", async () => {
  const now = Date.parse("2026-09-24T20:00:00Z");
  const ago = (min) => new Date(now - min * 60_000);
  const pages = [
    {
      Contents: [
        { Key: "email/a.json", LastModified: ago(5) }, // still retrying
        { Key: "email/b.json", LastModified: ago(20) }, // stuck
      ],
      IsTruncated: true,
      NextContinuationToken: "p2",
    },
    {
      Contents: [
        { Key: "editor/c.json", LastModified: ago(30) }, // still editing
        { Key: "editor/d.json", LastModified: ago(90) }, // retired lane; preserved, not an active incident
      ],
      IsTruncated: false,
    },
  ];
  const s3 = {
    send: async (cmd) => {
      assert.equal(cmd.input.Prefix, "email/");
      return cmd.input.ContinuationToken === "p2" ? pages[1] : pages[0];
    },
  };
  assert.equal(await countStuck("outbox-bucket", { s3, now }), 1);
});

test("upgrade enqueue retries use the same conditional object key", async () => {
  const puts = [];
  const send = makeOutbox("outbox", {
    send: async (cmd) => {
      puts.push(cmd.input);
      if (puts.length === 1)
        throw new Error("response lost after accepted put");
      throw { $metadata: { httpStatusCode: 412 } };
    },
  });
  const opts = { id: "stable-send", once: true };
  await assert.rejects(send("email", { kind: "collector_activity" }, opts));
  await send("email", { kind: "collector_activity" }, opts);
  assert.equal(puts[0].Key, puts[1].Key);
  assert.equal(puts[1].IfNoneMatch, "*");
});
