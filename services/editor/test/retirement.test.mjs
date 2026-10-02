import { test } from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { handler } from "../src/index.mjs";

test("retired direct and outbox editorial work never reads a brief or invokes a model handback", async (t) => {
  const calls = [];
  t.mock.method(S3Client.prototype, "send", async (command) => {
    calls.push(command.constructor.name);
    if (command.constructor.name === "GetObjectCommand") {
      assert.equal(command.input.Key, "editor/outbox/held.json");
      return {
        Body: {
          transformToString: async () =>
            JSON.stringify({ kind: "card_of_week", brief_key: "brief.json" }),
        },
      };
    }
    assert.equal(command.constructor.name, "DeleteObjectCommand");
    return {};
  });
  t.mock.method(LambdaClient.prototype, "send", async () =>
    assert.fail("no handback"),
  );
  for (const kind of ["top_100", "card_of_week"]) {
    assert.deepEqual(await handler({ kind, brief_key: "brief.json" }), {
      kind,
      skipped: "retired",
    });
  }
  assert.deepEqual(calls, []);
  const result = await handler({
    Records: [
      {
        body: JSON.stringify({
          Records: [
            {
              eventSource: "aws:s3",
              s3: {
                bucket: { name: "archive" },
                object: { key: "editor/outbox/held.json" },
              },
            },
          ],
        }),
      },
    ],
  });
  assert.equal(result.skipped, "retired");
  assert.deepEqual(calls, ["GetObjectCommand", "DeleteObjectCommand"]);
});

test("a kindless manual editorial invoke reads its brief and refuses before model work", async (t) => {
  t.mock.method(S3Client.prototype, "send", async (command) => {
    assert.equal(command.constructor.name, "GetObjectCommand");
    return {
      Body: {
        transformToString: async () => JSON.stringify({ kind: "top_100" }),
      },
    };
  });
  t.mock.method(LambdaClient.prototype, "send", async () =>
    assert.fail("no handback"),
  );
  assert.deepEqual(await handler({ brief_key: "old/brief.json" }), {
    kind: "top_100",
    skipped: "retired",
  });
});
