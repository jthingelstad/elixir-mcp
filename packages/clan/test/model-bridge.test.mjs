import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createModelBridge,
  createModelWorker,
  modelRequestKey,
  modelReplyKey,
  modelClaimKey,
} from "../src/model-bridge.mjs";
import { createBox } from "../src/sealed.mjs";
import { sealer } from "../src/manage/model.mjs";
const key = `sk-ant-${"x".repeat(24)}`;
const id = "00000000-0000-0000-0000-000000000001";
function memory() {
  const objects = new Map();
  return {
    objects,
    async get(k) {
      return objects.get(k) ?? null;
    },
    async put(k, text) {
      if (objects.has(k)) return false;
      objects.set(k, text);
      return true;
    },
  };
}
const input = {
  model: "claude-test",
  system: "Clan rules",
  prompt: "Draft words",
  tool: { name: "draft", input_schema: { type: "object" } },
  max_tokens: 400,
};
function request(
  storage,
  { expires_at = 45000, secret = "old-secret", method = "write" } = {},
) {
  const box = createBox(secret, "clan model bridge v1");
  storage.objects.set(
    modelRequestKey(id),
    JSON.stringify({
      v: 1,
      id,
      box: box.seal(
        JSON.stringify({ key, method, input, expires_at }),
        `request:${id}`,
      ),
    }),
  );
}
test("the private bridge preserves existing sealed keys and separates encryption domains", () => {
  const stored = sealer("old-secret").seal(key, "clan|player");
  assert.equal(sealer("old-secret").open(stored, "clan|player"), key);
  assert.equal(
    createBox("old-secret", "clan model bridge v1").open(stored, "clan|player"),
    null,
  );
  assert.equal(sealer("old-secret").open(stored, "other-clan|player"), null);
});
test("sealed requests and replies complete through the existing worker without exposing content", async () => {
  const storage = memory();
  let calls = 0;
  const worker = createModelWorker({
    secret: "old-secret",
    storage,
    provider: {
      async write(k, r) {
        calls++;
        assert.equal(k, key);
        assert.deepEqual(r, input);
        return {
          ok: true,
          input: { text: "Private draft" },
          usage: { input_tokens: 9 },
        };
      },
    },
  });
  const bridge = createModelBridge({
    secret: "old-secret",
    storage,
    pause: async () =>
      worker(
        [...storage.objects.keys()].find((k) =>
          k.startsWith("clan-model/request/"),
        ),
      ),
  });
  const result = await bridge.write(key, input);
  assert.equal(result.input.text, "Private draft");
  assert.equal(calls, 1);
  const serialized = [...storage.objects.values()].join();
  for (const privateText of [key, input.prompt, "Private draft"])
    assert.equal(serialized.includes(privateText), false);
});
test("duplicate notifications cannot repeat a paid call, including an uncertain interrupted call", async () => {
  const storage = memory();
  request(storage);
  let calls = 0;
  const worker = createModelWorker({
    secret: "old-secret",
    storage,
    now: () => 1,
    provider: {
      async write() {
        calls++;
        return { ok: true, input: {} };
      },
    },
  });
  await Promise.all([
    worker(modelRequestKey(id)),
    worker(modelRequestKey(id)).catch(() => {}),
  ]);
  await worker(modelRequestKey(id));
  assert.equal(calls, 1);
  storage.objects.delete(modelReplyKey(id));
  await assert.rejects(worker(modelRequestKey(id)), /reply pending/);
  assert.equal(
    calls,
    1,
    "a claimed call with no reply must not be tried again",
  );
  assert.ok(storage.objects.has(modelClaimKey(id)));
});
test("wrong secret, swapped id, untrusted methods and expired requests never reach the provider", async () => {
  for (const scenario of ["wrong-secret", "swapped-id", "method", "expired"]) {
    const storage = memory();
    request(storage, {
      secret: scenario === "wrong-secret" ? "different" : "old-secret",
      method: scenario === "method" ? "fetch" : "write",
      expires_at: scenario === "expired" ? 0 : 45000,
    });
    if (scenario === "swapped-id")
      storage.objects.set(
        modelRequestKey(id),
        storage.objects
          .get(modelRequestKey(id))
          .replace(id, "00000000-0000-0000-0000-000000000002"),
      );
    let calls = 0;
    const worker = createModelWorker({
      secret: "old-secret",
      storage,
      now: () => 1,
      provider: {
        write: async () => {
          calls++;
        },
      },
    });
    await worker(modelRequestKey(id)).catch(() => {});
    assert.equal(calls, 0, scenario);
  }
});
test("client timeouts report uncertainty without reissuing a request", async () => {
  const storage = memory();
  let clock = 0;
  const bridge = createModelBridge({
    secret: "old-secret",
    storage,
    now: () => clock,
    pause: async (ms) => {
      clock += ms;
    },
    timeoutMs: 1200,
  });
  assert.equal((await bridge.write(key, input)).code, "outcome_unknown");
  assert.equal(storage.objects.size, 1);
  assert.equal(
    (await bridge.write(key, { ...input, max_tokens: 100000 })).code,
    "invalid_model_request",
  );
  assert.equal(storage.objects.size, 1);
});

test("an unconfirmed key owner cannot spend the clan's tokens", async () => {
  const { createMemoryLedger } = await import("@elixir-mcp/clan-state");
  const { createModelService } = await import("../src/manage/model.mjs");
  const ledger = createMemoryLedger();
  await ledger.saveModelKey("#P0LYQ", {
    sealed: sealer("old-secret").seal(key, "#P0LYQ|#P2LQ0"),
    set_by: "#P2LQ0",
    model: "claude-test",
  });
  const service = createModelService({
    ledger,
    secret: "old-secret",
    rosterFor: async () => null,
    anthropic: {
      write: async () => assert.fail("unconfirmed owner must not spend tokens"),
    },
  });
  const who = { player_tag: "#P2LQ0", role: "leader" };
  assert.equal((await service.status("#P0LYQ", who, {})).usable, false);
  await assert.rejects(
    service.write("#P0LYQ", who, {}, { purpose: "recruit_pitch", ...input }),
    (e) => e.code === "model_owner_unconfirmed",
  );
  assert.equal((await ledger.modelCalls("#P0LYQ")).length, 0);
});

test("ambiguous S3 delivery/read failures return uncertainty and never reissue", async () => {
  for (const failure of ["put", "get"]) {
    let puts = 0;
    const bridge = createModelBridge({
      secret: "old-secret",
      storage: {
        async put() {
          puts++;
          if (failure === "put") throw new Error("transport");
          return true;
        },
        async get() {
          throw new Error("transport");
        },
      },
    });
    assert.equal((await bridge.write(key, input)).code, "outcome_unknown");
    assert.equal(puts, 1);
  }
});
test("an exhausted current request deadline starts no provider request", async () => {
  const storage = memory();
  const bridge = createModelBridge({
    secret: "old-secret",
    storage,
    timeoutMs: () => 500,
  });
  assert.equal((await bridge.write(key, input)).code, "model_not_started");
  assert.equal(storage.objects.size, 0);
});
test("a paid attempt is durable before dispatch, even when the final ledger update fails", async () => {
  const { createMemoryLedger } = await import("@elixir-mcp/clan-state");
  const { createModelService } = await import("../src/manage/model.mjs");
  for (const interruption of ["provider", "finish"]) {
    const ledger = createMemoryLedger();
    await ledger.saveModelKey("#P0LYQ", {
      sealed: sealer("old-secret").seal(key, "#P0LYQ|#P2LQ0"),
      set_by: "#P2LQ0",
      model: "claude-test",
    });
    if (interruption === "finish")
      ledger.finishModelCall = async () => {
        throw new Error("store unavailable");
      };
    const service = createModelService({
      ledger,
      secret: "old-secret",
      rosterFor: async () => ({
        members: [{ player_tag: "#P2LQ0", role: "leader" }],
      }),
      anthropic: {
        async write() {
          assert.equal(
            (await ledger.modelCalls("#P0LYQ")).length,
            1,
            "reserved before provider dispatch",
          );
          if (interruption === "provider")
            throw new Error("unknown transport outcome");
          return { ok: true, input: {} };
        },
      },
    });
    await assert.rejects(
      service.write(
        "#P0LYQ",
        { player_tag: "#P2LQ0", role: "leader" },
        {},
        { purpose: "recruit_pitch", ...input },
      ),
    );
    const calls = await ledger.modelCalls("#P0LYQ");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].code,
      interruption === "provider" ? "outcome_unknown" : "outcome_pending",
    );
  }
});
