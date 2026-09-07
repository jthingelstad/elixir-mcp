import { test } from "node:test";
import assert from "node:assert/strict";
import { makeInvoker, boundedArgs } from "../src/invoker.mjs";

const fakeDb = { query: async () => ({ rows: [] }) };
const account = { accountId: "00000000-0000-0000-0000-000000000000" };

test("invoker pings track with the tool name; surface picks the event", async () => {
  const pings = [];
  const invoke = makeInvoker({
    db: fakeDb,
    account,
    registry: { invoke: async () => ({ ok: true }) },
    track: async (event, value) => pings.push([event, value]),
  });
  await invoke("war_current", {});
  assert.deepEqual(pings, [["mcp.tool_call", "war_current"]]);

  const webPings = [];
  const invokeWeb = makeInvoker({
    db: fakeDb,
    account,
    registry: { invoke: async () => ({ ok: true }) },
    surface: "web",
    track: async (event, value) => webPings.push([event, value]),
  });
  await invokeWeb("players_summary", {});
  assert.deepEqual(webPings, [["explore.tool_call", "players_summary"]]);
});

test("a failing track never breaks the tool call (house rule)", async () => {
  const invoke = makeInvoker({
    db: fakeDb,
    account,
    registry: { invoke: async () => ({ ok: true }) },
    track: async () => {
      throw new Error("sqs down");
    },
  });
  const { body, isError } = await invoke("players_summary", {});
  assert.equal(isError, false);
  assert.deepEqual(body, { ok: true });
});

// --------------------------------------------------------------- #30
test("audit arguments are always valid JSON, whatever their size", () => {
  const parses = (v) => JSON.parse(JSON.stringify(v));

  // Under the budget: stored whole, unchanged.
  const small = {
    player_tag: "#20JJJ2CCRU",
    limit: 5,
    filters: { mode: "war" },
  };
  assert.deepEqual(boundedArgs(small), small);

  // Just under, at, and over the boundary all round-trip as JSON. The
  // old slice() cut mid-string exactly here and Postgres refused it.
  for (const len of [3900, 3960, 3980, 4000, 4001, 4096, 20000]) {
    const args = { message: "x".repeat(len) };
    const out = boundedArgs(args);
    assert.doesNotThrow(() => parses(out), `length ${len} must stay valid`);
    assert.ok(
      Buffer.byteLength(JSON.stringify(out)) <= 4000,
      `length ${len} must stay bounded`,
    );
  }

  // Multibyte text is measured in bytes, not characters, and never cut
  // through the middle of a character.
  const emoji = { message: "🐉".repeat(2000) };
  const cut = boundedArgs(emoji);
  assert.doesNotThrow(() => parses(cut));
  assert.equal(cut._audit.truncated, true);
  assert.ok(cut._audit.original_bytes > 4000);

  // Oversized calls keep what fits and name what they dropped, so the
  // row still says which call this was.
  const mixed = { tool_hint: "war", limit: 50, blob: "y".repeat(9000) };
  const kept = boundedArgs(mixed);
  assert.equal(kept.tool_hint, "war");
  assert.equal(kept.limit, 50);
  assert.deepEqual(kept._audit.dropped_keys, ["blob"]);
  assert.match(kept._audit.sha256, /^[0-9a-f]{64}$/);
  // Same call twice is recognisably the same call.
  assert.equal(boundedArgs(mixed)._audit.sha256, kept._audit.sha256);

  // An oversized array or scalar has no fields to keep, and is still
  // valid jsonb.
  const arr = boundedArgs(Array.from({ length: 3000 }, (_, i) => i));
  assert.equal(arr._audit.truncated, true);
  assert.doesNotThrow(() => parses(arr));

  assert.deepEqual(boundedArgs(undefined), {});
  assert.deepEqual(boundedArgs(null), {});
});

test("a credential never reaches an audit row by being an argument", () => {
  const out = boundedArgs({
    player_tag: "#20JJJ2CCRU",
    token: "sk-live-abc123",
    nested: { api_key: "k", code: "123456", limit: 5 },
    list: [{ password: "hunter2" }],
  });
  assert.equal(out.token, "[redacted]");
  assert.equal(out.nested.api_key, "[redacted]");
  assert.equal(out.nested.code, "[redacted]");
  assert.equal(out.list[0].password, "[redacted]");
  assert.equal(out.player_tag, "#20JJJ2CCRU", "real arguments are kept");
  assert.equal(out.nested.limit, 5);
});
