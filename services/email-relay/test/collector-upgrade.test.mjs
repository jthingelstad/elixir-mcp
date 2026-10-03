import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../src/handler.mjs";
import { upgradeDeliveryStore } from "../src/upgrade-delivery.mjs";

const id = "c375314f-8b15-4ee3-b021-6e375c777bab";
const msg = {
  v: 1,
  kind: "collector_activity",
  to: "owner@example.com",
  subject: "Collector upgraded",
  text: "v3.0.3 to v3.0.4",
  html: "<p>Upgrade</p>",
  send_id: id,
  issue_key: "collector-upgrade/test",
  unsubscribe: { url: "https://example.com/unsubscribe" },
};
const event = { Records: [{ messageId: "event", body: JSON.stringify(msg) }] };
function store() {
  const objects = new Map();
  const s3 = {
    send: async (cmd) => {
      const p = cmd.input;
      if (cmd.constructor.name === "PutObjectCommand") {
        if (p.IfNoneMatch && objects.has(p.Key))
          throw { $metadata: { httpStatusCode: 412 } };
        objects.set(p.Key, p.Body);
        return {};
      }
      if (cmd.constructor.name === "GetObjectCommand")
        return { Body: { transformToString: async () => objects.get(p.Key) } };
      if (cmd.constructor.name === "DeleteObjectCommand") {
        objects.delete(p.Key);
        return {};
      }
      throw Error("unsupported command");
    },
  };
  return upgradeDeliveryStore("test-bucket", s3);
}
test("stable delivery receipt suppresses duplicates including outbox deletion failure", async () => {
  let sends = 0;
  const handler = makeHandler({
    upgradeDelivery: store(),
    send: async () => {
      sends++;
      return { message_id: "ses-id" };
    },
    readObject: async () => JSON.stringify(msg),
    deleteObject: async () => {
      throw Error("delete unavailable");
    },
  });
  const s3event = {
    Records: [
      {
        messageId: "s3event",
        body: JSON.stringify({
          Records: [
            {
              eventSource: "aws:s3",
              s3: {
                bucket: { name: "test-bucket" },
                object: { key: "email/test.json" },
              },
            },
          ],
        }),
      },
    ],
  };
  assert.deepEqual(await handler(s3event), { batchItemFailures: [] });
  assert.deepEqual(await handler(s3event), { batchItemFailures: [] });
  assert.equal(sends, 1);
});
test("definitive SES rejection retries; ambiguous SES acceptance is never resent", async () => {
  let tries = 0;
  const handler = makeHandler({
    upgradeDelivery: store(),
    send: async () => {
      if (++tries === 1) throw { $metadata: { httpStatusCode: 429 } };
      return { message_id: "ses-id" };
    },
  });
  assert.equal((await handler(event)).batchItemFailures.length, 1);
  assert.equal((await handler(event)).batchItemFailures.length, 0);
  assert.equal(tries, 2);
  let uncertain = 0;
  const ambiguous = makeHandler({
    upgradeDelivery: store(),
    send: async () => {
      uncertain++;
      throw Error("lost SES response");
    },
  });
  assert.equal((await ambiguous(event)).batchItemFailures.length, 1);
  assert.equal((await ambiguous(event)).batchItemFailures.length, 1);
  assert.equal(uncertain, 1);
});
test("failed completion receipt does not resend an accepted email", async () => {
  const receipt = store();
  let sends = 0;
  const handler = makeHandler({
    upgradeDelivery: {
      ...receipt,
      finish: async () => {
        throw Error("receipt failed");
      },
    },
    send: async () => {
      sends++;
      return { message_id: "accepted" };
    },
  });
  assert.equal((await handler(event)).batchItemFailures.length, 1);
  assert.equal((await handler(event)).batchItemFailures.length, 1);
  assert.equal(sends, 1);
});
