/**
 * Capture the payloads (docs/REVIEW-2026-09-10-DOCS-TOOLS-SEAM.md, Part 5).
 *
 * Three properties, each pinned because the failure is silent: the
 * timings on the row are the TOOL's (db_ms counts the tool's queries and
 * not the audit insert; live_wait_ms is null until the live lane is
 * used); the body lands in S3 after the answer is composed and a failed
 * write leaves captured=false without touching the answer; and a
 * JSON-RPC-layer refusal writes a row with rpc_error_code and no
 * error_code. No database and no S3: both are fakes with the wire
 * shapes the real ones have.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import {
  makeInvoker,
  auditRow,
  onBehalfOfOf,
  timedDb,
  toolEmf,
} from "../src/invoker.mjs";
import { captureCall, captureKey } from "../src/capture.mjs";

const account = {
  accountId: "00000000-0000-0000-0000-000000000000",
  kind: "agent",
};

/** A db that records every audit insert and can sleep on demand. */
function recordingDb() {
  const writes = [];
  return {
    writes,
    query: async (sql, params) => {
      if (sql.includes("insert into mcp_call_audit")) writes.push(params);
      if (sql.startsWith("sleep")) await new Promise((r) => setTimeout(r, 15));
      return { rows: [] };
    },
  };
}

/** An S3 that keeps what it is sent, or refuses everything. */
function fakeS3({ fail = false } = {}) {
  const objects = new Map();
  return {
    objects,
    send: async (cmd) => {
      if (fail) throw new Error("AccessDenied");
      objects.set(cmd.input.Key, cmd.input);
      return {};
    },
  };
}

// Column positions in the audit insert (auditRow). Named here so a
// reordering fails one assertion rather than silently shifting meaning.
const COL = {
  account_id: 0,
  token_id: 1,
  request_id: 2,
  surface: 3,
  tool: 4,
  args: 5,
  duration_ms: 6,
  result_bytes: 7,
  truncated: 8,
  error_code: 9,
  created_at: 14,
  captured: 15,
  db_ms: 16,
  db_queries: 17,
  live_wait_ms: 18,
  serialize_ms: 19,
  cold_start: 20,
  principal_kind: 21,
  on_behalf_of: 22,
  rpc_error_code: 23,
};

test("db_ms and db_queries count the tool's queries, not the audit's", async () => {
  const db = recordingDb();
  const invoke = makeInvoker({
    db,
    account,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("sleep 1");
        await ctx.db.query("sleep 2");
        return { ok: true, meta: { as_of: "2026-09-10T00:00:00Z" } };
      },
    },
  });
  await invoke("war_current", {});
  const row = db.writes[0];
  assert.equal(
    row[COL.db_queries],
    2,
    "two tool queries, the audit is not one",
  );
  assert.ok(row[COL.db_ms] >= 25, `db_ms should be the sum: ${row[COL.db_ms]}`);
  assert.equal(row[COL.live_wait_ms], null, "no live fetch, no wait");
  assert.equal(typeof row[COL.serialize_ms], "number");
  assert.equal(row[COL.principal_kind], "agent");
  assert.equal(row[COL.captured], false, "no bucket, nothing captured");
  assert.equal(row[COL.error_code], null);
  assert.equal(row[COL.rpc_error_code], null);
  // created_at is the call's own start so the capture key partition and
  // the row agree.
  assert.match(row[COL.created_at], /^\d{4}-\d{2}-\d{2}T/);
});

test("the first call of a sandbox is the cold start; the rest are warm", async () => {
  // The flag is module-level, and the test above already flipped it, so
  // the observable here is that every call after the first says false.
  const db = recordingDb();
  const invoke = makeInvoker({
    db,
    account,
    registry: { invoke: async () => ({ ok: true }) },
  });
  await invoke("game_clock", {});
  assert.equal(db.writes[0][COL.cold_start], false);
});

test("live_wait_ms measures time blocked on the live lane", async () => {
  const db = recordingDb();
  const invoke = makeInvoker({
    db,
    account,
    live: async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true };
    },
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.live(ctx.db, { endpoint: "player", entityKey: "#X" });
        return { ok: true };
      },
    },
  });
  await invoke("live_fetch", { path: "/players/%23X" });
  assert.ok(db.writes[0][COL.live_wait_ms] >= 18);
});

test("on_behalf_of is recorded as given, from either place it can sit", () => {
  assert.equal(onBehalfOfOf({ on_behalf_of: "discord:42" }), "discord:42");
  assert.equal(
    onBehalfOfOf({ segment: { on_behalf_of: "u1" } }),
    "u1",
    "segment tools nest it",
  );
  assert.equal(onBehalfOfOf({}), null);
  assert.equal(onBehalfOfOf(undefined), null);
  assert.equal(onBehalfOfOf({ on_behalf_of: "x".repeat(500) }).length, 200);
});

test("timedDb never mutates the shared client", async () => {
  const shared = { query: async () => ({ rows: [1] }), other: 7 };
  const t = { db_ms: 0, db_queries: 0 };
  const wrapped = timedDb(shared, t);
  await wrapped.query("select 1");
  assert.equal(t.db_queries, 1);
  assert.equal(wrapped.other, 7, "other properties pass through");
  const before = shared.query;
  await wrapped.query("select 2");
  assert.equal(shared.query, before, "the client's own query is untouched");
});

test("the body is captured gzipped at calls/dt=<day>/request_id=<id>.json.gz", async () => {
  const s3 = fakeS3();
  const db = recordingDb();
  const invoke = makeInvoker({
    db,
    account,
    capture: { s3, bucket: "archive" },
    registry: {
      invoke: async () => ({
        answer: [1, 2, 3],
        meta: { as_of: "2026-09-10T00:00:00Z" },
      }),
    },
  });
  const { body } = await invoke("war_current", {
    clan_tag: "#ABC",
    access_token: "should-not-land",
    refresh_token: "should-not-land-either",
  });
  const row = db.writes[0];
  assert.equal(row[COL.captured], true);
  const requestId = row[COL.request_id];
  const key = captureKey(row[COL.created_at], requestId);
  assert.match(
    key,
    /^calls\/dt=\d{4}-\d{2}-\d{2}\/request_id=[0-9a-f-]{36}\.json\.gz$/,
  );
  const put = s3.objects.get(key);
  assert.ok(
    put,
    `expected ${key} in the bucket; got ${[...s3.objects.keys()]}`,
  );
  assert.equal(put.Bucket, "archive");
  assert.equal(put.ContentEncoding, "gzip");
  const stored = JSON.parse(gunzipSync(put.Body).toString("utf8"));
  assert.equal(stored.request.tool, "war_current");
  assert.equal(stored.request.arguments.clan_tag, "#ABC");
  assert.equal(
    stored.request.arguments.access_token,
    "[redacted]",
    "credential-shaped arguments are redacted from the capture",
  );
  assert.equal(
    stored.request.arguments.refresh_token,
    "[redacted]",
    "refresh credentials cannot land in the capture either",
  );
  assert.deepEqual(stored.response.answer, [1, 2, 3]);
  assert.equal(
    stored.response.meta.request_id,
    body.meta.request_id,
    "the captured body is the one the caller received",
  );
  assert.equal(typeof stored.timings.db_ms, "number");
  assert.equal(typeof stored.timings.cold_start, "boolean");
  assert.equal(stored.surface, "mcp");
  assert.equal(stored.principal_kind, "agent");
  assert.match(stored.captured_at, /^\d{4}-/);
});

test("a failed capture write leaves captured=false and the answer intact", async () => {
  const s3 = fakeS3({ fail: true });
  const db = recordingDb();
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const invoke = makeInvoker({
      db,
      account,
      capture: { s3, bucket: "archive" },
      registry: { invoke: async () => ({ ok: true }) },
    });
    const { body, isError } = await invoke("game_clock", {});
    assert.equal(isError, false);
    assert.deepEqual(body, { ok: true });
    assert.equal(db.writes[0][COL.captured], false);
    assert.ok(
      errors.some((a) => a[0] === "call_capture_failed"),
      "the failure is named",
    );
  } finally {
    console.error = original;
  }
});

test("captureCall without a store is a no-op that reports false", async () => {
  assert.equal(
    await captureCall({ requestId: "x", request: {}, response: {} }),
    false,
  );
});

test("a tool failure is captured as the error body the caller saw", async () => {
  const s3 = fakeS3();
  const db = recordingDb();
  const invoke = makeInvoker({
    db,
    account,
    capture: { s3, bucket: "archive" },
    registry: {
      invoke: async () => {
        throw new Error("boom");
      },
    },
  });
  const original = console.error;
  console.error = () => {};
  try {
    const { isError } = await invoke("war_current", {});
    assert.equal(isError, true);
  } finally {
    console.error = original;
  }
  const row = db.writes[0];
  assert.equal(row[COL.error_code], "internal");
  assert.equal(row[COL.captured], true);
  const [put] = s3.objects.values();
  const stored = JSON.parse(gunzipSync(put.Body).toString("utf8"));
  assert.equal(stored.response.error.code, "bad_request");
});

test("one EMF line per call, with and without the Tool dimension", async () => {
  const lines = [];
  const invoke = makeInvoker({
    db: recordingDb(),
    account,
    emitMetrics: (line) => lines.push(line),
    registry: { invoke: async () => ({ ok: true }) },
  });
  await invoke("clans_roster", {});
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith("\n"), "one log event per line");
  const emf = JSON.parse(lines[0]);
  const [def] = emf._aws.CloudWatchMetrics;
  assert.equal(def.Namespace, "ElixirMCP/Tools");
  assert.deepEqual(def.Dimensions, [["Tool"], []]);
  assert.deepEqual(
    def.Metrics.map((m) => m.Name),
    ["DurationMs", "DbMs", "ResultBytes", "Errors"],
  );
  assert.equal(emf.Tool, "clans_roster");
  assert.equal(emf.Errors, 0);
  assert.equal(typeof emf.DurationMs, "number");
  assert.equal(
    lines[0].indexOf("\n"),
    lines[0].length - 1,
    "no embedded newline: EMF is one JSON object per log event",
  );
});

test("toolEmf counts an error as 1", () => {
  const emf = JSON.parse(
    toolEmf({
      tool: "x",
      durationMs: 5,
      dbMs: 1,
      resultBytes: 10,
      error: true,
    }),
  );
  assert.equal(emf.Errors, 1);
});

test("a JSON-RPC-layer refusal audits with rpc_error_code and no error_code", async () => {
  const db = recordingDb();
  await auditRow(db, {
    accountId: account.accountId,
    tokenId: null,
    requestId: "11111111-1111-4111-8111-111111111111",
    surface: "mcp",
    tool: "elixir_add_player",
    args: { player_tag: "#ABC", token: "nope" },
    startedAt: Date.now(),
    principalKind: "agent",
    rpcErrorCode: -32601,
  });
  const row = db.writes[0];
  assert.equal(row[COL.tool], "elixir_add_player");
  assert.equal(row[COL.rpc_error_code], -32601);
  assert.equal(row[COL.error_code], null, "no tool ran");
  assert.equal(row[COL.captured], false);
  assert.equal(row[COL.db_ms], null, "nothing to time");
  assert.equal(JSON.parse(row[COL.args]).token, "[redacted]");
  assert.equal(row[COL.principal_kind], "agent");
});
