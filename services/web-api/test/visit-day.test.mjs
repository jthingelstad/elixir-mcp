/**
 * The website visit mark (0321, src/visit-day.mjs), against a real
 * PostgreSQL database: one account_visit_day row a person a UTC day,
 * written only by the app's session read (GET /api/me) on a cookie
 * session, and never the reason a request fails.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import { makeVisitMarker } from "../src/visit-day.mjs";

let scratch, handler, ME, OTHER;
const tokens = new Map();

async function person(hash) {
  const id = (
    await scratch.db.query(
      `insert into account (email_hash, status, role)
       values ($1, 'approved', 'member') returning account_id`,
      [hash],
    )
  ).rows[0].account_id;
  const { token } = await createSession(scratch.db, {
    secret: "test",
    accountId: id,
    emailHash: hash,
  });
  tokens.set(id, token);
  return id;
}

const request = (path, { cookie = null, bearer = null } = {}, h = handler) =>
  h({
    path,
    method: "GET",
    queryStringParameters: {},
    headers: {
      ...(cookie
        ? { cookie: `__Host-elixir_session=${tokens.get(cookie)}` }
        : {}),
      ...(bearer ? { authorization: `Bearer ${tokens.get(bearer)}` } : {}),
      "x-elixir-client": "web",
    },
  });

const days = async (id) =>
  (
    await scratch.db.query(
      `select day::text from account_visit_day where account_id = $1 order by day`,
      [id],
    )
  ).rows.map((r) => r.day);

before(async () => {
  scratch = await scratchDb("visit_day");
  handler = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  ME = await person("visit-me");
  OTHER = await person("visit-other");
});

after(async () => {
  await handler?.close?.();
  await scratch?.drop();
});

test("the app's session read on a cookie session marks the UTC day, once", async () => {
  const first = await request("/api/me", { cookie: ME });
  assert.equal(first.statusCode, 200);
  assert.equal(JSON.parse(first.body).authenticated, true);
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(await days(ME), [today]);
  const again = await request("/api/me", { cookie: ME });
  assert.equal(again.statusCode, 200);
  assert.deepEqual(await days(ME), [today], "still one row for the day");
});

test("nothing else marks a visit", async () => {
  // Anonymous: no session, no mark.
  const anon = await request("/api/me");
  assert.equal(JSON.parse(anon.body).authenticated, false);
  // A bearer token is a tool or a script, not a person in a browser.
  const viaBearer = await request("/api/me", { bearer: OTHER });
  assert.equal(JSON.parse(viaBearer.body).authenticated, true);
  // Another signed-in route: the bell, the push devices (what an open tab
  // or the service worker might ask on its own).
  for (const path of ["/api/me/bell", "/api/me/push"])
    await request(path, { cookie: OTHER });
  // The JSON API's one read (GET /api/v1/me) takes no cookie session.
  await request("/api/v1/me", { cookie: OTHER });
  assert.deepEqual(await days(OTHER), []);
});

test("a warm instance asks the database once a person a day", async () => {
  const calls = [];
  const db = { query: async (sql, params) => calls.push(params) };
  const mark = makeVisitMarker();
  const day = Date.parse("2026-11-28T10:00:00Z");
  assert.equal(await mark(db, "a", day), true);
  assert.equal(await mark(db, "a", day + 3_600_000), false);
  assert.equal(await mark(db, "b", day), true);
  // The next UTC day starts over.
  assert.equal(await mark(db, "a", Date.parse("2026-11-29T00:00:01Z")), true);
  assert.deepEqual(calls, [
    ["a", "2026-11-28"],
    ["b", "2026-11-28"],
    ["a", "2026-11-29"],
  ]);
});

test("a failed mark logs one line, tries again next time, and never fails the request", async () => {
  // The unit: a throwing database is a false and a line with no id.
  const lines = [];
  const warn = console.warn;
  console.warn = (line) => lines.push(line);
  let fail = true;
  const db = {
    query: async () => {
      if (fail) throw Object.assign(new Error("down"), { code: "57P01" });
    },
  };
  const mark = makeVisitMarker();
  try {
    assert.equal(await mark(db, "acct-1"), false);
    fail = false;
    assert.equal(await mark(db, "acct-1"), true, "a failed pair is retried");
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(lines, [
    { at: "visit_mark_failed", name: "Error", code: "57P01" },
  ]);

  // The door: with the table gone, the session read still answers.
  const fresh = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  const third = await person("visit-third");
  await scratch.db.query(
    `alter table account_visit_day rename to account_visit_day_away`,
  );
  console.warn = () => {};
  try {
    const res = await request("/api/me", { cookie: third }, fresh);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).authenticated, true);
  } finally {
    console.warn = warn;
    await scratch.db.query(
      `alter table account_visit_day_away rename to account_visit_day`,
    );
    await fresh.close?.();
  }
  assert.deepEqual(await days(third), []);
});

test("only the visit marker writes account_visit_day", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const writers = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".git", "dist", "test", "e2e"].includes(name))
        continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(mjs|js|jsx|ts|tsx)$/.test(name)) {
        const text = readFileSync(path, "utf8");
        if (/insert into account_visit_day/.test(text))
          writers.push(relative(root, path));
      }
    }
  };
  for (const top of ["services", "packages", "apps"]) walk(join(root, top));
  assert.deepEqual(writers, ["services/web-api/src/visit-day.mjs"]);
});
