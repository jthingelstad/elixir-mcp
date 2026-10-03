import test from "node:test";
import assert from "node:assert/strict";
import { modelStorage } from "../src/model-storage.mjs";

test("only confirmed missing model objects are absence; access denial stays a failure", async () => {
  for (const name of ["NoSuchKey", "NotFound", "AccessDenied"]) {
    const storage = modelStorage("private", {
      async send(command) {
        assert.equal(command.input.Bucket, "private");
        assert.equal(command.input.Key, "clan-model/reply/example.json");
        throw Object.assign(new Error(name), { name });
      },
    });
    if (name === "AccessDenied")
      await assert.rejects(storage.get("clan-model/reply/example.json"), {
        name,
      });
    else assert.equal(await storage.get("clan-model/reply/example.json"), null);
  }
});

const reply = "clan-model/reply/00000000-0000-0000-0000-000000000001.json";
const denied = () =>
  Object.assign(new Error("denied"), { name: "AccessDenied" });
test("a scoped exact-key list confirms absence without hiding an existing denied object", async () => {
  for (const listed of [
    { KeyCount: 0, IsTruncated: false },
    { Contents: [], IsTruncated: false },
    { Contents: [{ Key: reply }], KeyCount: 1, IsTruncated: false },
    { Contents: [], IsTruncated: true },
    {},
  ]) {
    const lookupError = denied();
    const commands = [];
    const storage = modelStorage("private", {
      async send(command) {
        commands.push(command);
        if (command.constructor.name === "GetObjectCommand") throw lookupError;
        assert.equal(command.constructor.name, "ListObjectsV2Command");
        assert.deepEqual(command.input, {
          Bucket: "private",
          Prefix: reply,
          MaxKeys: 1,
        });
        return listed;
      },
    });
    if (
      listed.IsTruncated === false &&
      (listed.KeyCount === 0 || listed.Contents?.length === 0)
    )
      assert.equal(await storage.get(reply), null);
    else await assert.rejects(storage.get(reply), (e) => e === lookupError);
    assert.equal(commands.length, 2);
  }
});
test("a denied scoped list and request or malformed keys never become absence", async () => {
  for (const key of [
    reply,
    reply.replace("reply", "request"),
    "email/example.json",
    "clan-model/claim/example.json",
    reply + "/outside",
  ]) {
    const commands = [];
    const storage = modelStorage("private", {
      async send(command) {
        commands.push(command);
        throw denied();
      },
    });
    await assert.rejects(storage.get(key), { name: "AccessDenied" });
    assert.equal(commands.length, key === reply ? 2 : 1);
  }
});
