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

test("Discord objects go to the Discord worker only; disabled transport refuses", async () => {
  const seen = [];
  const handler = makeHandler({
    send: async () => assert.fail("not an email"),
    readObject: async () => assert.fail("worker owns its reads"),
    deleteObject: async () => assert.fail("no email deletion"),
    modelObject: async () => assert.fail("not a model call"),
    discordObject: async (object) => seen.push(object.key),
  });
  assert.deepEqual(
    await handler(notification("clan-discord/request/test.json")),
    { batchItemFailures: [] },
  );
  assert.deepEqual(seen, ["clan-discord/request/test.json"]);
  const disabled = makeHandler({ send: async () => assert.fail("no send") });
  assert.deepEqual(
    await disabled(notification("clan-discord/request/test.json")),
    { batchItemFailures: [{ itemIdentifier: "test" }] },
  );
});

test("timeline Discord objects go to their worker only; disabled transport refuses", async () => {
  const seen = [];
  const handler = makeHandler({
    send: async () => assert.fail("not an email"),
    readObject: async () => assert.fail("worker owns its reads"),
    deleteObject: async () => assert.fail("no email deletion"),
    discordObject: async () => assert.fail("not Clan's"),
    timelineDiscordObject: async (object) => seen.push(object.key),
  });
  assert.deepEqual(await handler(notification("timeline-discord/test.json")), {
    batchItemFailures: [],
  });
  assert.deepEqual(seen, ["timeline-discord/test.json"]);
  const disabled = makeHandler({ send: async () => assert.fail("no send") });
  assert.deepEqual(await disabled(notification("timeline-discord/test.json")), {
    batchItemFailures: [{ itemIdentifier: "test" }],
  });
});
