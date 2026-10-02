import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../src/handler.mjs";
const notification = (key) => ({
  Records: [
    {
      messageId: "test",
      body: JSON.stringify({
        Records: [
          {
            eventSource: "aws:s3",
            s3: { bucket: { name: "private" }, object: { key } },
          },
        ],
      }),
    },
  ],
});
test("private model objects never take the email or delete path; disabled transport refuses", async () => {
  let called = 0;
  const handler = makeHandler({
    send: async () => assert.fail("not an email"),
    readObject: async () => assert.fail("worker owns its reads"),
    deleteObject: async () => assert.fail("no email deletion"),
    modelObject: async (object) => {
      assert.equal(object.key, "clan-model/request/test.json");
      called++;
    },
  });
  assert.deepEqual(
    await handler(notification("clan-model/request/test.json")),
    { batchItemFailures: [] },
  );
  assert.equal(called, 1);
  const disabled = makeHandler({ send: async () => assert.fail("no send") });
  assert.deepEqual(
    await disabled(notification("clan-model/request/test.json")),
    { batchItemFailures: [{ itemIdentifier: "test" }] },
  );
  assert.deepEqual(
    await handler({
      Records: [
        {
          messageId: "direct",
          body: JSON.stringify({ method: "write", key: "not-a-credential" }),
        },
      ],
    }),
    { batchItemFailures: [{ itemIdentifier: "direct" }] },
  );
  assert.equal(called, 1, "direct queue messages cannot call the provider");
});
