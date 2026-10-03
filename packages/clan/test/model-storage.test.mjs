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
