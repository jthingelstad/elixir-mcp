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

// ------------------------------------------------- 0052: the principal
// An audit column nothing verifies is one that silently stops being
// written. These pin the two halves: what the caller gets back, and what
// the row records.

function recordingDb() {
  const writes = [];
  return {
    writes,
    query: async (sql, params) => {
      if (sql.includes("insert into mcp_call_audit")) writes.push(params);
      return { rows: [] };
    },
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("a response names the audit row that produced it", async () => {
  const db = recordingDb();
  const invoke = makeInvoker({
    db,
    account,
    registry: {
      invoke: async () => ({
        ok: true,
        meta: { as_of: "2026-09-08T00:00:00Z" },
      }),
    },
  });

  const { body } = await invoke("war_current", {});
  const [params] = db.writes;
  const [, , requestId] = params;

  assert.match(body.meta.request_id, UUID_RE);
  assert.equal(
    body.meta.request_id,
    requestId,
    "the id the caller quotes must be the id on the row",
  );
});

test("a service token is recorded as the principal, not just its account", async () => {
  const db = recordingDb();
  const invoke = makeInvoker({
    db,
    account: { ...account, tokenId: 42 },
    registry: { invoke: async () => ({ ok: true, meta: {} }) },
    surface: "svc:elixir-mcp-discord",
  });
  await invoke("clans_roster", {});
  const [accountId, tokenId] = db.writes[0];
  assert.equal(accountId, account.accountId);
  assert.equal(tokenId, 42);
});

test("an OAuth call audits with a null token, not a crash", async () => {
  const db = recordingDb();
  const invoke = makeInvoker({
    db,
    account, // no tokenId — the browser flow
    registry: { invoke: async () => ({ ok: true, meta: {} }) },
  });
  await invoke("players_summary", {});
  assert.equal(db.writes[0][1], null);
});

test("a failing tool still returns an id, and the same one it audited", async () => {
  const db = recordingDb();
  const invoke = makeInvoker({
    db,
    account: { ...account, tokenId: 7 },
    registry: {
      invoke: async () => {
        throw new Error("boom");
      },
    },
  });
  const { body, isError } = await invoke("battles_query", {});
  assert.equal(isError, true);
  assert.equal(body.meta.request_id, db.writes[0][2]);
  assert.equal(db.writes[0][1], 7);
});

test("a body with no envelope is left alone rather than given a broken one", async () => {
  const db = recordingDb();
  const invoke = makeInvoker({
    db,
    account,
    registry: { invoke: async () => ({ ok: true }) },
  });
  const { body } = await invoke("cards_catalog", {});
  assert.deepEqual(body, { ok: true }, "no half-built meta envelope");
  assert.match(db.writes[0][2], UUID_RE, "but the row still has an id");
});
