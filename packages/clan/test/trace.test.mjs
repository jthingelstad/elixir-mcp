/**
 * One story per request: the trace and the Server-Timing header. A log
 * group holding only START/END/REPORT told nobody where 20 seconds went;
 * this is what says it. Clan writes no line of its own (2026-11-13): the
 * answer carries the story as `trace`, and the web API's one line per
 * request folds it in (services/web-api/test/clan-session.test.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestAccount } from "./fakes.mjs";
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import {
  createManageService,
  fetchParticipation,
} from "@elixir-mcp/clan/manage/service.mjs";
import { createAwardsService } from "@elixir-mcp/clan/manage/awards.mjs";
import {
  fakeRecord,
  player,
  req,
  signIn,
  cookieHeader,
  ledgerWithPolicy,
} from "./fakes.mjs";
import {
  member,
  participation,
  NOW,
  EXAMPLE_POLICY,
} from "@elixir-mcp/clan-engine/fixtures";
import { serverTiming, summarize, timedRead } from "@elixir-mcp/clan/trace.mjs";
import { routeKey } from "@elixir-mcp/clan/handler.mjs";

/** The logger the handler is given: the request story, captured. */
function capturing() {
  const lines = [];
  return {
    lines,
    log: {
      info: (l) => lines.push(["log", l]),
      warn: (l) => lines.push(["warn", l]),
      error() {},
    },
  };
}
const capture = async (fn, cap) => {
  cap.lines.length = 0;
  const r = await fn();
  return { r, lines: [...cap.lines] };
};

test("every request carries one story naming the route, the status, the time, and each read of the record; plus Server-Timing", async () => {
  const now = () => NOW.getTime();
  const part = participation(
    [
      member("#098R2R0PUL", { name: "Ada", role: "leader" }),
      ...Array.from({ length: 9 }, (_, i) => member(`#M${i}`)),
    ],
    {
      clan_tag: "#0QC8RCGY",
    },
  );
  const record = fakeRecord({ players: [player()] });
  const inner = record.rawRead.bind(record);
  record.read = (name, args) =>
    timedRead(name, async () => {
      if (name === "clans_participation") return { ok: true, body: part };
      return inner(name, args);
    });
  const ledger = ledgerWithPolicy(
    createMemoryLedger(),
    "#0QC8RCGY",
    EXAMPLE_POLICY,
  );
  const cap = capturing();
  const handler = createHandler({
    record,
    ...createTestAccount(),
    manage: createManageService({ ledger, record, now }),
    awards: createAwardsService({
      ledger,
      now,
      participationFor: (c) => fetchParticipation(record, c),
    }),
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now,
    log: cap.log,
  });
  const h = { handler };
  const { r: cookie } = await capture(
    async () => cookieHeader((await signIn(h)).sessionCookie),
    cap,
  );
  const { r, lines } = await capture(
    () =>
      handler(req("GET", "/api/clans/0QC8RCGY/manage", { cookies: cookie })),
    cap,
  );
  assert.equal(r.statusCode, 200);
  assert.match(
    r.headers["server-timing"],
    /^total;dur=\d+, elixir;dur=\d+;desc="\d+ calls", store;dur=\d+;desc="\d+ ops", own;dur=\d+/,
  );
  assert.deepEqual(
    lines.filter(([k]) => k === "log"),
    [],
    "Clan writes no line of its own",
  );
  const line = r.trace;
  assert.equal(
    line.http,
    "GET /api/clan/clans/*/manage",
    "the route, not the tag",
  );
  assert.equal(line.status, 200);
  assert.equal(line.clan, "#0QC8RCGY");
  assert.equal(line.role, "leader");
  assert.ok(line.ms >= 0 && line.elixir_calls >= 2, JSON.stringify(line));
  const calls = line.elixir.map((c) => c.call);
  assert.ok(calls.includes("clans_participation"), calls.join(","));
  // A read in process has no request id of its own: the web API's line
  // carries the request's.
  assert.equal(
    "request_id" in line.elixir.find((c) => c.call === "clans_participation"),
    false,
  );
});

test("route keys hide ids and tags; a slow or failed request is a warn", async () => {
  const now = () => NOW.getTime();
  const cap = capturing();
  const handler = createHandler({
    record: fakeRecord(),
    ...createTestAccount(),
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now,
    log: cap.log,
  });
  const { r } = await capture(
    () => handler(req("GET", "/api/roster", {})),
    cap,
  );
  const line = r.trace;
  assert.equal(line.http, "GET /api/clan/roster");
  assert.equal(line.status, 401);
  assert.equal(
    routeKey("GET", "/api/clans/0QC8RCGY/members/0RJL/notes"),
    "GET /api/clans/*/members/*/notes",
  );
  assert.equal(
    routeKey("POST", "/api/clans/0QC8RCGY/actions/abc_1/decide"),
    "POST /api/clans/*/actions/*/decide",
  );
  assert.equal(
    routeKey(
      "DELETE",
      "/api/clans/0QC8RCGY/awards/grants/135/points_podium/0RJL",
    ),
    "DELETE /api/clans/*/awards/grants/*",
  );
  assert.equal(
    routeKey("GET", "/api/maintain/feedback/abc123"),
    "GET /api/maintain/feedback/*",
  );
  assert.equal(routeKey("GET", "/api/feedback"), "GET /api/feedback");

  const slow = summarize(
    {
      started: Date.now() - 9000,
      meta: { http: "GET /api/me" },
      elixir: [{ call: "x", ms: 8500, ok: true }],
      store: [],
      notes: [],
      cold: true,
    },
    200,
  );
  assert.equal(slow.level, "warn");
  assert.equal(slow.cold, true);
  assert.match(serverTiming(slow), /cold$/);
  const failed = summarize(
    {
      started: Date.now(),
      meta: {},
      elixir: [],
      store: [],
      notes: [],
      cold: false,
    },
    502,
  );
  assert.equal(failed.level, "warn");
  assert.equal(failed.status, 502);
});

test("trusted lock timing is included in total and separated from handler work", async () => {
  const cap = capturing();
  const handler = createHandler({
    record: fakeRecord(),
    ...createTestAccount(),
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    log: cap.log,
  });
  const result = await handler(
    { ...req("GET", "/api/roster", {}), requestId: "viewer-supplied" },
    { lockMs: 750 },
  );
  const line = result.trace;
  assert.equal(line.lock_ms, 750);
  // The request id is the web API's line's own, never the viewer's.
  assert.equal("request_id" in line, false);
  assert.ok(line.ms >= 750);
  assert.match(result.headers["server-timing"], /lock;dur=750/);
  const headerOwn = Number(
    /own;dur=(\d+)/.exec(result.headers["server-timing"])[1],
  );
  assert.equal(
    headerOwn,
    Math.max(0, line.ms - line.elixir_ms - line.store_ms - 750),
  );
  const untrusted = await handler(req("GET", "/api/roster", {}), {
    lockMs: "untrusted-fixture",
  });
  assert.equal(untrusted.trace.lock_ms, undefined);
});
